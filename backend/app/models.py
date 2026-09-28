from sqlalchemy import Column, Integer, String, Numeric, DateTime, Text, JSON, ForeignKey
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
    costo = Column(Numeric(12, 2), default=0)
    venta = Column(Numeric(12, 2), default=0)
    costo_menudeo = Column(Numeric(12, 2), default=0)
    notas_internas = Column(Text, default="")
    proveedores_alternativos = Column(String(500), default="")
    variantes = Column(JSON, default=list)
    creado = Column(DateTime(timezone=True), server_default=func.now())
    actualizado = Column(DateTime(timezone=True), onupdate=func.now())


# ── NOTIFICACIONES ───────────────────────────────────────────────────

class Notificacion(Base):
    __tablename__ = "notificaciones"
    id = Column(Integer, primary_key=True, index=True)
    mensaje = Column(String(500), nullable=False)
    leida = Column(Integer, default=0) # 0=falsa, 1=verdadera (SQLite compatible)
    tipo = Column(String(50), default="stock_bajo")
    producto_id = Column(Integer, ForeignKey("productos.id", ondelete="CASCADE"), nullable=True)
    fecha = Column(DateTime(timezone=True), server_default=func.now())


class Movimiento(Base):
    __tablename__ = "movimientos"
    id = Column(Integer, primary_key=True, index=True)
    tipo = Column(String(50), nullable=False)   # venta | entrada | ajuste
    producto_id = Column(Integer, ForeignKey("productos.id", ondelete="SET NULL"), nullable=True)
    producto_nombre = Column(String(200))
    variante = Column(String(200), default="")
    qty = Column(Integer)
    precio = Column(Numeric(12, 2), default=0)
    canal = Column(String(100), default="")
    notas = Column(Text, default="")
    fecha = Column(DateTime(timezone=True), server_default=func.now())


# ── DESCUENTOS ───────────────────────────────────────────────────────

class Descuento(Base):
    __tablename__ = "descuentos"
    id = Column(Integer, primary_key=True, index=True)
    codigo = Column(String(50), unique=True, nullable=False, index=True)
    tipo = Column(String(20), nullable=False) # porcentaje | fijo
    valor = Column(Numeric(12, 2), nullable=False)
    min_items = Column(Integer, default=1)
    barcode = Column(String(100), nullable=True, index=True)
    activo = Column(Integer, default=1) # 1=activo, 0=inactivo
    creado = Column(DateTime(timezone=True), server_default=func.now())



# ── ÓRDENES DE COMPRA ────────────────────────────────────────────────

class OrdenCompra(Base):
    __tablename__ = "ordenes_compra"
    id = Column(Integer, primary_key=True, index=True)
    folio = Column(String(30), nullable=False, unique=True, index=True)
    proveedor = Column(String(200), default="")
    estado = Column(String(20), nullable=False, default="borrador")  # borrador | enviada | confirmada
    total_estimado = Column(Numeric(12, 2), default=0.0)
    notas = Column(Text, default="")
    tipo_compra = Column(String(50), default="ropa") # ropa | insumo | equipo
    canal_compra = Column(String(100), default="")
    marca = Column(String(100), default="")
    pago_msi = Column(Integer, default=0) # 0=falso, 1=verdadero
    meses_msi = Column(Integer, default=1)
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
    precio_proveedor = Column(Numeric(12, 2), default=0.0)
    subtotal = Column(Numeric(12, 2), default=0.0)       # qty * precio_proveedor
    es_obligatoria = Column(Integer, default=0)


# ── HISTORIAL DE PRECIOS ─────────────────────────────────────────────

class HistorialPrecio(Base):
    __tablename__ = "historial_precios"
    id = Column(Integer, primary_key=True, index=True)
    producto_id = Column(Integer, ForeignKey("productos.id", ondelete="CASCADE"), nullable=False)
    costo_anterior = Column(Numeric(12, 2), default=0)
    costo_nuevo = Column(Numeric(12, 2), default=0)
    venta_anterior = Column(Numeric(12, 2), default=0)
    venta_nuevo = Column(Numeric(12, 2), default=0)
    fecha = Column(DateTime(timezone=True), server_default=func.now())


# ── USUARIOS / AUTENTICACIÓN ──────────────────────────────────────────

class Usuario(Base):
    __tablename__ = "usuarios"
    id            = Column(Integer, primary_key=True, index=True)
    username      = Column(String(50), unique=True, nullable=False, index=True)
    nombre        = Column(String(200), default="")
    email         = Column(String(200), unique=True, nullable=True, index=True) # Temporarily nullable for migration
    password_hash = Column(String(200), nullable=False)
    rol           = Column(String(20), default="vendedor")  # admin | vendedor | bodeguero
    activo        = Column(Integer, default=1)              # 1=activo, 0=desactivado
    totp_secret   = Column(String(32), nullable=True)
    totp_enabled  = Column(Integer, default=0)              # 1=activado, 0=desactivado
    creado        = Column(DateTime(timezone=True), server_default=func.now())


# ── LOGS DE AUDITORÍA ────────────────────────────────────────────────

class AuditLog(Base):
    __tablename__ = "audit_logs"
    id          = Column(Integer, primary_key=True, index=True)
    usuario_id  = Column(Integer, ForeignKey("usuarios.id", ondelete="SET NULL"), nullable=True)
    username    = Column(String(50))
    accion      = Column(String(100), nullable=False) # LOGIN, CREATE_PRODUCT, etc.
    recurso     = Column(String(100))                # Producto, Movimiento, Usuario
    recurso_id  = Column(String(100))                # ID del recurso afectado
    detalles    = Column(JSON)                       # Datos adicionales del cambio
    fecha       = Column(DateTime(timezone=True), server_default=func.now())


# ── CONTABILIDAD E INSUMOS ───────────────────────────────────────────

class CatalogoInsumo(Base):
    __tablename__ = "catalogo_insumos"
    id = Column(Integer, primary_key=True, index=True)
    nombre = Column(String(200), nullable=False, index=True)
    descripcion = Column(Text, default="")
    creado = Column(DateTime(timezone=True), server_default=func.now())

class ContabilidadTransaccion(Base):
    __tablename__ = "contabilidad_transacciones"
    id = Column(Integer, primary_key=True, index=True)
    tipo = Column(String(50), nullable=False, index=True) # ingreso, gasto_ropa, gasto_insumo, gasto_equipo
    monto = Column(Numeric(12, 2), nullable=False)
    fecha = Column(DateTime(timezone=True), nullable=False) # Allows setting future dates for MSI
    procedencia_destino = Column(String(200), default="")
    concepto = Column(String(500), default="")
    referencia_id = Column(Integer, nullable=True) # ID de OC u otra entidad
    creado = Column(DateTime(timezone=True), server_default=func.now())

