from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from fastapi import HTTPException
from app import models, schemas
from app.sku import generar_sku
from typing import Optional
from datetime import datetime, time


async def _contador_categoria(db: AsyncSession, categoria: str) -> int:
    result = await db.execute(
        select(models.Producto).where(models.Producto.categoria == categoria)
    )
    return len(result.scalars().all()) + 1


async def get_productos(db: AsyncSession, skip: int = 0, limit: int = 1000):
    stmt = select(models.Producto).order_by(models.Producto.nombre).offset(skip).limit(limit)
    res = await db.execute(stmt)
    return res.scalars().all()


async def get_all_productos(db: AsyncSession):
    stmt = select(models.Producto).order_by(models.Producto.nombre)
    res = await db.execute(stmt)
    return res.scalars().all()


async def crear_producto(db: AsyncSession, data: schemas.ProductoCreate):
    datos = data.model_dump()

    # Generar SKU automático si no se proporcionó
    if not datos.get("sku", "").strip():
        contador = await _contador_categoria(db, datos["categoria"])
        datos["sku"] = generar_sku(
            categoria=datos["categoria"],
            nombre=datos["nombre"],
            variantes=datos.get("variantes", []),
            contador=contador,
        )

    p = models.Producto(**datos)
    db.add(p)
    await db.flush()
    if p.qty > 0:
        mov = models.Movimiento(
            tipo="entrada", producto_id=p.id,
            producto_nombre=p.nombre, qty=p.qty,
            canal="Inventario inicial"
        )
        db.add(mov)
    await db.commit()
    await db.refresh(p)
    return p


async def get_producto(db: AsyncSession, id: int):
    p = await db.get(models.Producto, id)
    if not p:
        raise HTTPException(404, "Producto no encontrado")
    return p


async def actualizar_producto(db: AsyncSession, id: int, data: schemas.ProductoUpdate):
    p = await get_producto(db, id)
    datos = data.model_dump()

    # Regenerar SKU si se dejó vacío al editar
    if not datos.get("sku", "").strip():
        contador = await _contador_categoria(db, datos["categoria"])
        datos["sku"] = generar_sku(
            categoria=datos["categoria"],
            nombre=datos["nombre"],
            variantes=datos.get("variantes", []),
            contador=contador,
        )

    for k, v in datos.items():
        setattr(p, k, v)
    await db.commit()
    await db.refresh(p)
    return p


async def eliminar_producto(db: AsyncSession, id: int):
    p = await get_producto(db, id)
    await db.delete(p)
    await db.commit()


async def cambiar_qty(db: AsyncSession, id: int, delta: int):
    p = await get_producto(db, id)
    p.qty = max(0, p.qty + delta)
    mov = models.Movimiento(
        tipo="entrada" if delta > 0 else "ajuste",
        producto_id=p.id, producto_nombre=p.nombre,
        qty=abs(delta), canal="Ajuste rápido"
    )
    db.add(mov)
    await db.commit()
    await db.refresh(p)
    return p


async def registrar_venta(db: AsyncSession, data: schemas.VentaRequest):
    p = await get_producto(db, data.producto_id)
    if data.qty > p.qty:
        raise HTTPException(400, f"Stock insuficiente (disponible: {p.qty})")
    p.qty -= data.qty
    mov = models.Movimiento(
        tipo="venta", producto_id=p.id, producto_nombre=p.nombre,
        variante=data.variante, qty=data.qty, precio=data.precio,
        canal=data.canal, notas=data.notas
    )
    db.add(mov)
    await db.commit()
    await db.refresh(mov)
    return mov


async def ajustar_inventario(db: AsyncSession, id: int, data: schemas.AjusteRequest):
    p = await get_producto(db, id)
    diff = data.nueva_qty - p.qty
    p.qty = data.nueva_qty
    mov = models.Movimiento(
        tipo="entrada" if diff >= 0 else "ajuste",
        producto_id=p.id, producto_nombre=p.nombre,
        qty=abs(diff), canal=data.motivo, notas=data.notas
    )
    db.add(mov)
    await db.commit()
    await db.refresh(mov)
    return mov


async def get_movimientos(db: AsyncSession, tipo: Optional[str] = None, skip: int = 0, limit: int = 500):
    stmt = select(models.Movimiento).order_by(models.Movimiento.fecha.desc())
    if tipo:
        stmt = stmt.filter(models.Movimiento.tipo == tipo)
    stmt = stmt.offset(skip).limit(limit)
    res = await db.execute(stmt)
    return res.scalars().all()


async def get_all_ventas(db: AsyncSession, desde: Optional[str] = None, hasta: Optional[str] = None):
    stmt = select(models.Movimiento).filter(models.Movimiento.tipo == "venta")
    if desde:
        try:
            desde_dt = datetime.strptime(desde, "%Y-%m-%d")
            stmt = stmt.filter(models.Movimiento.fecha >= desde_dt)
        except ValueError:
            pass
    if hasta:
        try:
            hasta_dt = datetime.combine(datetime.strptime(hasta, "%Y-%m-%d"), time(23, 59, 59))
            stmt = stmt.filter(models.Movimiento.fecha <= hasta_dt)
        except ValueError:
            pass
    res = await db.execute(stmt)
    return res.scalars().all()


async def eliminar_movimiento(db: AsyncSession, id: int):
    m = await db.get(models.Movimiento, id)
    if not m:
        raise HTTPException(404, "Movimiento no encontrado")
    if m.producto_id:
        p = await db.get(models.Producto, m.producto_id)
        if p:
            if m.tipo == "venta":
                p.qty += m.qty
            elif m.tipo == "entrada":
                p.qty = max(0, p.qty - m.qty)
    await db.delete(m)
    await db.commit()
    return True


async def actualizar_movimiento(db: AsyncSession, id: int, data: schemas.MovimientoUpdate):
    m = await db.get(models.Movimiento, id)
    if not m:
        raise HTTPException(404, "Movimiento no encontrado")
    if m.producto_id and (data.qty is not None):
        p = await db.get(models.Producto, m.producto_id)
        if p:
            diff = data.qty - m.qty
            if m.tipo == "venta":
                if p.qty < diff:
                    raise HTTPException(400, f"Stock insuficiente para ajustar (disponible: {p.qty})")
                p.qty -= diff
            elif m.tipo == "entrada":
                p.qty = max(0, p.qty + diff)
    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(m, k, v)
    await db.commit()
    await db.refresh(m)
    return m
