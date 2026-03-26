from contextlib import asynccontextmanager
from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List, Optional
from app.database import get_db, engine
from app import models, schemas, services

@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(models.Base.metadata.create_all)
    yield

app = FastAPI(title="Inventario API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── PRODUCTOS ──
@app.get("/productos", response_model=List[schemas.ProductoOut])
async def listar_productos(db: AsyncSession = Depends(get_db)):
    return await services.get_all_productos(db)

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

# ── VENTAS ──
@app.post("/ventas", response_model=schemas.MovimientoOut, status_code=201)
async def registrar_venta(data: schemas.VentaRequest, db: AsyncSession = Depends(get_db)):
    return await services.registrar_venta(db, data)

# ── AJUSTES ──
@app.post("/productos/{id}/ajuste", response_model=schemas.MovimientoOut)
async def ajustar_inventario(id: int, data: schemas.AjusteRequest, db: AsyncSession = Depends(get_db)):
    return await services.ajustar_inventario(db, id, data)

# ── HISTORIAL ──
@app.get("/movimientos", response_model=List[schemas.MovimientoOut])
async def listar_movimientos(tipo: Optional[str] = None, db: AsyncSession = Depends(get_db)):
    return await services.get_movimientos(db, tipo=tipo)

@app.delete("/movimientos/{id}", status_code=204)
async def eliminar_movimiento(id: int, db: AsyncSession = Depends(get_db)):
    return await services.eliminar_movimiento(db, id)

@app.put("/movimientos/{id}", response_model=schemas.MovimientoOut)
async def actualizar_movimiento(id: int, data: schemas.MovimientoUpdate, db: AsyncSession = Depends(get_db)):
    return await services.actualizar_movimiento(db, id, data)

# ── REPORTE ──
@app.get("/reporte")
async def reporte(desde: Optional[str] = None, hasta: Optional[str] = None, db: AsyncSession = Depends(get_db)):
    ventas = await services.get_all_ventas(db, desde=desde, hasta=hasta)
    productos = await services.get_all_productos(db)

    prod_map = {p.id: p for p in productos}
    ingresos = sum(v.precio * v.qty for v in ventas)
    costo_vendido = sum((prod_map[v.producto_id].costo if v.producto_id in prod_map else 0) * v.qty for v in ventas)
    unidades = sum(v.qty for v in ventas)
    top = {}
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
        "top_productos": [{"nombre": k, **v} for k, v in top_sorted]
    }

@app.get("/health")
def health():
    return {"status": "ok"}
