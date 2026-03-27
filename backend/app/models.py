from sqlalchemy import Column, Integer, String, Float, DateTime, Text, JSON, ForeignKey
from sqlalchemy.sql import func
from app.database import Base


class Producto(Base):
    __tablename__ = "productos"
    id = Column(Integer, primary_key=True, index=True)
    nombre = Column(String(200), nullable=False)
    sku = Column(String(100), default="")
    categoria = Column(String(100), default="Otro")
    qty = Column(Integer, default=0)
    min_stock = Column(Integer, default=5)
    costo = Column(Float, default=0)
    venta = Column(Float, default=0)
    variantes = Column(JSON, default=list)
    creado = Column(DateTime(timezone=True), server_default=func.now())
    actualizado = Column(DateTime(timezone=True), onupdate=func.now())


class Movimiento(Base):
    __tablename__ = "movimientos"
    id = Column(Integer, primary_key=True, index=True)
    tipo = Column(String(50), nullable=False)   # venta | entrada | ajuste
    producto_id = Column(Integer, ForeignKey("productos.id", ondelete="SET NULL"), nullable=True)
    producto_nombre = Column(String(200))
    variante = Column(String(200), default="")
    qty = Column(Integer)
    precio = Column(Float, default=0)
    canal = Column(String(100), default="")
    notas = Column(Text, default="")
    fecha = Column(DateTime(timezone=True), server_default=func.now())


# ── ÓRDENES DE COMPRA ────────────────────────────────────────────────

class OrdenCompra(Base):
    __tablename__ = "ordenes_compra"
    id = Column(Integer, primary_key=True, index=True)
    folio = Column(String(30), nullable=False, unique=True, index=True)
    proveedor = Column(String(200), default="")
    estado = Column(String(20), nullable=False, default="borrador")  # borrador | enviada | confirmada
    total_estimado = Column(Float, default=0.0)
    notas = Column(Text, default="")
    creado = Column(DateTime(timezone=True), server_default=func.now())
    actualizado = Column(DateTime(timezone=True), onupdate=func.now())


class OrdenCompraItem(Base):
    __tablename__ = "ordenes_compra_items"
    id = Column(Integer, primary_key=True, index=True)
    orden_id = Column(Integer, ForeignKey("ordenes_compra.id", ondelete="CASCADE"), nullable=False)
    producto_id = Column(Integer, ForeignKey("productos.id", ondelete="SET NULL"), nullable=True)
    producto_nombre = Column(String(200), default="")
    publico = Column(String(50), default="")    # Adulto, Juvenil, Niño, Bebé
    genero = Column(String(50), default="")     # Caballero, Dama, Unisex
    color = Column(String(100), default="")
    talla = Column(String(50), default="")
    qty = Column(Integer, default=0)
    precio_proveedor = Column(Float, default=0.0)
    subtotal = Column(Float, default=0.0)       # qty * precio_proveedor
