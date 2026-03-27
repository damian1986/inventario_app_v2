from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime


class ProductoCreate(BaseModel):
    nombre: str
    sku: str = ""
    categoria: str = "Otro"
    qty: int = 0
    min_stock: int = 5
    costo: float = 0
    venta: float = 0
    variantes: List[str] = []


class ProductoUpdate(ProductoCreate):
    pass


class ProductoOut(ProductoCreate):
    id: int
    creado: Optional[datetime] = None

    class Config:
        from_attributes = True


class MovimientoCreate(BaseModel):
    tipo: str
    producto_id: Optional[int] = None
    producto_nombre: str
    variante: str = ""
    qty: int
    precio: float = 0
    canal: str = ""
    notas: str = ""


class MovimientoOut(MovimientoCreate):
    id: int
    fecha: Optional[datetime] = None

    class Config:
        from_attributes = True


class VentaRequest(BaseModel):
    producto_id: int
    variante: str = ""
    qty: int
    precio: float
    canal: str = "Venta directa"
    notas: str = ""


class MovimientoUpdate(BaseModel):
    qty: Optional[int] = None
    precio: Optional[float] = None
    canal: Optional[str] = None
    notas: Optional[str] = None


class AjusteRequest(BaseModel):
    nueva_qty: int
    motivo: str = "Ajuste manual"
    notas: str = ""


# ── ÓRDENES DE COMPRA ────────────────────────────────────────────────

class OrdenCompraItemIn(BaseModel):
    producto_id: Optional[int] = None
    producto_nombre: str = ""
    publico: str = ""
    genero: str = ""
    color: str = ""
    talla: str = ""
    qty: int
    precio_proveedor: float = 0.0


class OrdenCompraItemOut(OrdenCompraItemIn):
    id: int
    orden_id: int
    subtotal: float

    class Config:
        from_attributes = True


class OrdenCompraCreate(BaseModel):
    proveedor: str = ""
    notas: str = ""
    items: List[OrdenCompraItemIn] = []


class OrdenCompraUpdate(BaseModel):
    proveedor: Optional[str] = None
    notas: Optional[str] = None
    items: Optional[List[OrdenCompraItemIn]] = None


class OrdenCompraOut(BaseModel):
    id: int
    folio: str
    proveedor: str
    estado: str
    total_estimado: float
    notas: str
    creado: Optional[datetime] = None
    actualizado: Optional[datetime] = None
    items: List[OrdenCompraItemOut] = []

    class Config:
        from_attributes = True


class EstadoOrdenIn(BaseModel):
    estado: str   # "enviada" o "confirmada"
