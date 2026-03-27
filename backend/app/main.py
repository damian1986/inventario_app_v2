from contextlib import asynccontextmanager
from fastapi import FastAPI, Depends, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from typing import List, Optional
from datetime import datetime
from app.database import get_db, engine
from app import models, schemas, services
from app.sku import generar_sku
import random


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(models.Base.metadata.create_all)
    yield


app = FastAPI(title="Inventario API", version="2.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── PRODUCTOS ─────────────────────────────────────────────────────────
@app.get("/productos", response_model=List[schemas.ProductoOut])
async def listar_productos(
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=1000, ge=1, le=5000),
    db: AsyncSession = Depends(get_db)
):
    return await services.get_productos(db, skip=skip, limit=limit)


@app.post("/productos", response_model=schemas.ProductoOut, status_code=201)
async def crear_producto(data: schemas.ProductoCreate, db: AsyncSession = Depends(get_db)):
    return await services.crear_producto(db, data)


@app.get("/productos/{id}", response_model=schemas.ProductoOut)
async def obtener_producto(id: int, db: AsyncSession = Depends(get_db)):
    return await services.get_producto(db, id)


@app.put("/productos/{id}", response_model=schemas.ProductoOut)
async def actualizar_producto(id: int, data: schemas.ProductoUpdate, db: AsyncSession = Depends(get_db)):
    return await services.actualizar_producto(db, id, data)


@app.delete("/productos/{id}", status_code=204)
async def eliminar_producto(id: int, db: AsyncSession = Depends(get_db)):
    await services.eliminar_producto(db, id)


@app.patch("/productos/{id}/qty")
async def cambiar_qty(id: int, delta: int, db: AsyncSession = Depends(get_db)):
    return await services.cambiar_qty(db, id, delta)


# ── VENTAS ────────────────────────────────────────────────────────────
@app.post("/ventas", response_model=schemas.MovimientoOut, status_code=201)
async def registrar_venta(data: schemas.VentaRequest, db: AsyncSession = Depends(get_db)):
    return await services.registrar_venta(db, data)


# ── AJUSTES ──────────────────────────────────────────────────────────
@app.post("/productos/{id}/ajuste", response_model=schemas.MovimientoOut)
async def ajustar_inventario(id: int, data: schemas.AjusteRequest, db: AsyncSession = Depends(get_db)):
    return await services.ajustar_inventario(db, id, data)


# ── HISTORIAL ────────────────────────────────────────────────────────
@app.get("/movimientos", response_model=List[schemas.MovimientoOut])
async def listar_movimientos(
    tipo: Optional[str] = None,
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=500, ge=1, le=2000),
    db: AsyncSession = Depends(get_db)
):
    return await services.get_movimientos(db, tipo=tipo, skip=skip, limit=limit)


@app.delete("/movimientos/{id}", status_code=204)
async def eliminar_movimiento(id: int, db: AsyncSession = Depends(get_db)):
    return await services.eliminar_movimiento(db, id)


@app.put("/movimientos/{id}", response_model=schemas.MovimientoOut)
async def actualizar_movimiento(id: int, data: schemas.MovimientoUpdate, db: AsyncSession = Depends(get_db)):
    return await services.actualizar_movimiento(db, id, data)


# ── REPORTE ──────────────────────────────────────────────────────────
@app.get("/reporte")
async def reporte(
    desde: Optional[str] = None,
    hasta: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
):
    ventas = await services.get_all_ventas(db, desde=desde, hasta=hasta)
    productos = await services.get_all_productos(db)
    prod_map = {p.id: p for p in productos}
    ingresos = sum(v.precio * v.qty for v in ventas)
    costo_vendido = sum(
        (prod_map[v.producto_id].costo if v.producto_id in prod_map else 0) * v.qty
        for v in ventas
    )
    unidades = sum(v.qty for v in ventas)
    top: dict = {}
    for v in ventas:
        if v.producto_nombre not in top:
            top[v.producto_nombre] = {"qty": 0, "ingresos": 0, "costo": 0}
        costo = prod_map[v.producto_id].costo if v.producto_id in prod_map else 0
        top[v.producto_nombre]["qty"] += v.qty
        top[v.producto_nombre]["ingresos"] += v.precio * v.qty
        top[v.producto_nombre]["costo"] += costo * v.qty
    top_sorted = sorted(top.items(), key=lambda x: x[1]["qty"], reverse=True)
    return {
        "ingresos": ingresos,
        "costo_vendido": costo_vendido,
        "ganancia": ingresos - costo_vendido,
        "unidades": unidades,
        "top_productos": [{"nombre": k, **v} for k, v in top_sorted],
    }


# ── UTILIDADES ──────────────────────────────────────────────────────
@app.get("/sku/preview")
async def preview_sku(
    categoria: str,
    nombre: str,
    variantes: str = "",
    db: AsyncSession = Depends(get_db),
):
    lista_variantes = [v.strip() for v in variantes.split(",") if v.strip()]
    from app.services import _contador_categoria
    contador = await _contador_categoria(db, categoria)
    sku = generar_sku(
        categoria=categoria,
        nombre=nombre,
        variantes=lista_variantes,
        contador=contador,
    )
    return {"sku": sku}


@app.get("/health")
def health():
    return {"status": "ok"}


# ── ÓRDENES DE COMPRA ────────────────────────────────────────────────

def _generar_folio() -> str:
    now = datetime.utcnow()
    num = random.randint(1000, 9999)
    return f"OC-{now.year}-{num:04d}"


@app.get("/ordenes-compra", response_model=List[schemas.OrdenCompraOut])
async def listar_ordenes(
    estado: Optional[str] = None,
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=500),
    db: AsyncSession = Depends(get_db)
):
    q = select(models.OrdenCompra).order_by(models.OrdenCompra.id.desc())
    if estado:
        q = q.where(models.OrdenCompra.estado == estado)
    q = q.offset(skip).limit(limit)
    result = await db.execute(q)
    ordenes = result.scalars().all()

    # Cargar items de cada orden
    out = []
    for orden in ordenes:
        items_q = await db.execute(
            select(models.OrdenCompraItem).where(models.OrdenCompraItem.orden_id == orden.id)
        )
        orden_dict = {
            "id": orden.id,
            "folio": orden.folio,
            "proveedor": orden.proveedor or "",
            "estado": orden.estado,
            "total_estimado": orden.total_estimado or 0.0,
            "notas": orden.notas or "",
            "creado": orden.creado,
            "actualizado": orden.actualizado,
            "items": [
                {
                    "id": it.id,
                    "orden_id": it.orden_id,
                    "producto_id": it.producto_id,
                    "producto_nombre": it.producto_nombre or "",
                    "publico": it.publico or "",
                    "genero": it.genero or "",
                    "color": it.color or "",
                    "talla": it.talla or "",
                    "qty": it.qty,
                    "precio_proveedor": it.precio_proveedor or 0.0,
                    "subtotal": it.subtotal or 0.0,
                }
                for it in items_q.scalars().all()
            ]
        }
        out.append(orden_dict)
    return out


@app.get("/ordenes-compra/{orden_id}", response_model=schemas.OrdenCompraOut)
async def obtener_orden(orden_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(models.OrdenCompra).where(models.OrdenCompra.id == orden_id)
    )
    orden = result.scalar_one_or_none()
    if not orden:
        raise HTTPException(status_code=404, detail="Orden no encontrada")

    items_q = await db.execute(
        select(models.OrdenCompraItem).where(models.OrdenCompraItem.orden_id == orden_id)
    )
    return {
        "id": orden.id,
        "folio": orden.folio,
        "proveedor": orden.proveedor or "",
        "estado": orden.estado,
        "total_estimado": orden.total_estimado or 0.0,
        "notas": orden.notas or "",
        "creado": orden.creado,
        "actualizado": orden.actualizado,
        "items": [
            {
                "id": it.id,
                "orden_id": it.orden_id,
                "producto_id": it.producto_id,
                "producto_nombre": it.producto_nombre or "",
                "publico": it.publico or "",
                "genero": it.genero or "",
                "color": it.color or "",
                "talla": it.talla or "",
                "qty": it.qty,
                "precio_proveedor": it.precio_proveedor or 0.0,
                "subtotal": it.subtotal or 0.0,
            }
            for it in items_q.scalars().all()
        ]
    }


@app.post("/ordenes-compra", response_model=schemas.OrdenCompraOut, status_code=201)
async def crear_orden(
    data: schemas.OrdenCompraCreate,
    db: AsyncSession = Depends(get_db)
):
    # Generar folio único
    folio = _generar_folio()
    while True:
        existing = await db.execute(
            select(models.OrdenCompra).where(models.OrdenCompra.folio == folio)
        )
        if not existing.scalar_one_or_none():
            break
        folio = _generar_folio()

    # Calcular total
    total = sum(it.qty * it.precio_proveedor for it in data.items)

    orden = models.OrdenCompra(
        folio=folio,
        proveedor=data.proveedor,
        estado="borrador",
        total_estimado=total,
        notas=data.notas,
    )
    db.add(orden)
    await db.flush()  # Para obtener el id de la orden

    items_out = []
    for it in data.items:
        subtotal = it.qty * it.precio_proveedor
        item = models.OrdenCompraItem(
            orden_id=orden.id,
            producto_id=it.producto_id,
            producto_nombre=it.producto_nombre,
            publico=it.publico,
            genero=it.genero,
            color=it.color,
            talla=it.talla,
            qty=it.qty,
            precio_proveedor=it.precio_proveedor,
            subtotal=subtotal,
        )
        db.add(item)
        items_out.append(item)

    await db.commit()
    await db.refresh(orden)

    return {
        "id": orden.id,
        "folio": orden.folio,
        "proveedor": orden.proveedor or "",
        "estado": orden.estado,
        "total_estimado": orden.total_estimado or 0.0,
        "notas": orden.notas or "",
        "creado": orden.creado,
        "actualizado": orden.actualizado,
        "items": [
            {
                "id": it.id,
                "orden_id": it.orden_id,
                "producto_id": it.producto_id,
                "producto_nombre": it.producto_nombre or "",
                "publico": it.publico or "",
                "genero": it.genero or "",
                "color": it.color or "",
                "talla": it.talla or "",
                "qty": it.qty,
                "precio_proveedor": it.precio_proveedor or 0.0,
                "subtotal": it.subtotal or 0.0,
            }
            for it in items_out
        ]
    }


@app.put("/ordenes-compra/{orden_id}", response_model=schemas.OrdenCompraOut)
async def actualizar_orden(
    orden_id: int,
    data: schemas.OrdenCompraUpdate,
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        select(models.OrdenCompra).where(models.OrdenCompra.id == orden_id)
    )
    orden = result.scalar_one_or_none()
    if not orden:
        raise HTTPException(status_code=404, detail="Orden no encontrada")
    if orden.estado == "confirmada":
        raise HTTPException(status_code=400, detail="No se puede editar una orden confirmada")

    if data.proveedor is not None:
        orden.proveedor = data.proveedor
    if data.notas is not None:
        orden.notas = data.notas

    items_out = []
    if data.items is not None:
        # Borrar items previos y reemplazar
        await db.execute(
            delete(models.OrdenCompraItem).where(models.OrdenCompraItem.orden_id == orden_id)
        )
        total = 0.0
        for it in data.items:
            subtotal = it.qty * it.precio_proveedor
            total += subtotal
            item = models.OrdenCompraItem(
                orden_id=orden.id,
                producto_id=it.producto_id,
                producto_nombre=it.producto_nombre,
                publico=it.publico,
                genero=it.genero,
                color=it.color,
                talla=it.talla,
                qty=it.qty,
                precio_proveedor=it.precio_proveedor,
                subtotal=subtotal,
            )
            db.add(item)
            items_out.append(item)
        orden.total_estimado = total
    else:
        items_q = await db.execute(
            select(models.OrdenCompraItem).where(models.OrdenCompraItem.orden_id == orden_id)
        )
        items_out = items_q.scalars().all()

    await db.commit()
    await db.refresh(orden)

    return {
        "id": orden.id,
        "folio": orden.folio,
        "proveedor": orden.proveedor or "",
        "estado": orden.estado,
        "total_estimado": orden.total_estimado or 0.0,
        "notas": orden.notas or "",
        "creado": orden.creado,
        "actualizado": orden.actualizado,
        "items": [
            {
                "id": it.id,
                "orden_id": it.orden_id,
                "producto_id": it.producto_id,
                "producto_nombre": it.producto_nombre or "",
                "publico": it.publico or "",
                "genero": it.genero or "",
                "color": it.color or "",
                "talla": it.talla or "",
                "qty": it.qty,
                "precio_proveedor": it.precio_proveedor or 0.0,
                "subtotal": it.subtotal or 0.0,
            }
            for it in items_out
        ]
    }


@app.post("/ordenes-compra/{orden_id}/estado", response_model=schemas.OrdenCompraOut)
async def cambiar_estado_orden(
    orden_id: int,
    data: schemas.EstadoOrdenIn,
    db: AsyncSession = Depends(get_db)
):
    nuevo_estado = data.estado.lower()
    if nuevo_estado not in ("enviada", "confirmada"):
        raise HTTPException(status_code=400, detail="estado debe ser 'enviada' o 'confirmada'")

    result = await db.execute(
        select(models.OrdenCompra).where(models.OrdenCompra.id == orden_id)
    )
    orden = result.scalar_one_or_none()
    if not orden:
        raise HTTPException(status_code=404, detail="Orden no encontrada")
    if orden.estado == "confirmada":
        raise HTTPException(status_code=400, detail="La orden ya está confirmada")

    if nuevo_estado == "enviada":
        orden.estado = "enviada"
        await db.commit()

    elif nuevo_estado == "confirmada":
        if orden.estado not in ("borrador", "enviada"):
            raise HTTPException(status_code=400, detail="Solo se puede confirmar una orden en borrador o enviada")

        items_q = await db.execute(
            select(models.OrdenCompraItem).where(models.OrdenCompraItem.orden_id == orden_id)
        )
        items = items_q.scalars().all()

        for it in items:
            if not it.producto_id:
                continue

            # Obtener el producto
            prod_result = await db.execute(
                select(models.Producto).where(models.Producto.id == it.producto_id)
            )
            producto = prod_result.scalar_one_or_none()
            if not producto:
                continue

            # Sumar al stock
            producto.qty += it.qty

            # Crear movimiento de entrada
            mov = models.Movimiento(
                tipo="entrada",
                producto_id=it.producto_id,
                producto_nombre=it.producto_nombre or producto.nombre,
                variante="",
                qty=it.qty,
                precio=it.precio_proveedor,
                canal="Orden de Compra",
                notas=f"Confirmación {orden.folio}",
            )
            db.add(mov)

        orden.estado = "confirmada"
        await db.commit()

    await db.refresh(orden)

    items_q2 = await db.execute(
        select(models.OrdenCompraItem).where(models.OrdenCompraItem.orden_id == orden_id)
    )
    items_final = items_q2.scalars().all()

    return {
        "id": orden.id,
        "folio": orden.folio,
        "proveedor": orden.proveedor or "",
        "estado": orden.estado,
        "total_estimado": orden.total_estimado or 0.0,
        "notas": orden.notas or "",
        "creado": orden.creado,
        "actualizado": orden.actualizado,
        "items": [
            {
                "id": it.id,
                "orden_id": it.orden_id,
                "producto_id": it.producto_id,
                "producto_nombre": it.producto_nombre or "",
                "publico": it.publico or "",
                "genero": it.genero or "",
                "color": it.color or "",
                "talla": it.talla or "",
                "qty": it.qty,
                "precio_proveedor": it.precio_proveedor or 0.0,
                "subtotal": it.subtotal or 0.0,
            }
            for it in items_final
        ]
    }
