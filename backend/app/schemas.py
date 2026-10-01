from pydantic import BaseModel
from typing import List, Optional, Any, Union
from datetime import datetime

class ProductoCreate(BaseModel):
    nombre: str
    sku: str = ""
    categoria: str = "Otro"
    qty: int = 0
    min_stock: int = 5
    costo: float = 0
    venta: float = 0
    costo_menudeo: float = 0
    notas_internas: str = ""
    proveedores_alternativos: str = ""
    variantes: List[Any] = []

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
    es_obligatoria: int = 0


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
    tipo_compra: str = "ropa"
    canal_compra: str = ""
    marca: str = ""
    pago_msi: int = 0
    meses_msi: int = 1

class OrdenCompraUpdate(BaseModel):
    proveedor: Optional[str] = None
    notas: Optional[str] = None
    items: Optional[List[OrdenCompraItemIn]] = None
    tipo_compra: Optional[str] = None
    canal_compra: Optional[str] = None
    marca: Optional[str] = None
    pago_msi: Optional[int] = None
    meses_msi: Optional[int] = None

class OrdenCompraOut(BaseModel):
    id: int
    folio: str
    proveedor: str
    estado: str
    total_estimado: float
    notas: str
    tipo_compra: str = "ropa"
    canal_compra: str = ""
    marca: str = ""
    pago_msi: int = 0
    meses_msi: int = 1
    creado: Optional[datetime] = None
    actualizado: Optional[datetime] = None
    items: List[OrdenCompraItemOut] = []

    class Config:
        from_attributes = True


class EstadoOrdenIn(BaseModel):
    estado: str   # "enviada", "confirmada" o "cancelada"


# ── NOTIFICACIONES ───────────────────────────────────────────────────

class NotificacionOut(BaseModel):
    id: int
    mensaje: str
    leida: int
    tipo: str
    producto_id: Optional[int] = None
    fecha: datetime

    class Config:
        from_attributes = True


class NotificacionUpdate(BaseModel):
    leida: Optional[int] = None

# ── HISTORIAL DE PRECIOS ─────────────────────────────────────────────

class HistorialPrecioOut(BaseModel):
    id: int
    producto_id: int
    costo_anterior: float
    costo_nuevo: float
    venta_anterior: float
    venta_nuevo: float
    fecha: datetime

    class Config:
        from_attributes = True


# ── AUTENTICACIÓN / USUARIOS ──────────────────────────────────────────────────

class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: Optional[str] = None
    token_type: str = "bearer"
    rol: Optional[str] = None
    username: Optional[str] = None
    nombre: Optional[str] = None
    id: Optional[int] = None
    requires_2fa: bool = False
    temp_token: Optional[str] = None
    metodos_2fa: Optional[List[str]] = None   # ["totp", "passkey"]


class TOTPSetupResponse(BaseModel):
    secret: str
    provisioning_uri: str


class TOTPVerifyRequest(BaseModel):
    code: str
    temp_token: Optional[str] = None


# ── PASSKEYS (WEBAUTHN) ──────────────────────────────────────────────

class WebAuthnRegisterVerifyRequest(BaseModel):
    credential: dict                      # JSON completo de navigator.credentials.create()
    nombre: Optional[str] = None


class WebAuthnLoginOptionsRequest(BaseModel):
    temp_token: Optional[str] = None


class WebAuthnLoginVerifyRequest(BaseModel):
    temp_token: Optional[str] = None
    credential: dict                      # JSON completo de navigator.credentials.get()


class WebAuthnCredentialOut(BaseModel):
    id: int
    nombre: str = ""
    transports: str = ""
    creado: Optional[datetime] = None
    ultimo_uso: Optional[datetime] = None

    class Config:
        from_attributes = True


class UsuarioCreate(BaseModel):
    username: str
    nombre: str
    email: str
    password: str
    rol: str = "vendedor"

class UsuarioOut(BaseModel):
    id: int
    username: str
    nombre: str
    email: Optional[str] = None
    rol: str
    activo: int
    totp_enabled: int = 0
    creado: Optional[datetime] = None

    class Config:
        from_attributes = True

class UsuarioUpdate(BaseModel):
    username: Optional[str] = None
    nombre: Optional[str] = None
    email: Optional[str] = None
    password: Optional[str] = None
    rol: Optional[str] = None
    activo: Optional[int] = None


# ── DESCUENTOS ───────────────────────────────────────────────────────

class DescuentoCreate(BaseModel):
    codigo: str
    tipo: str  # porcentaje | fijo
    valor: float
    min_items: int = 1
    barcode: Optional[str] = None
    activo: int = 1


class DescuentoUpdate(BaseModel):
    codigo: Optional[str] = None
    tipo: Optional[str] = None
    valor: Optional[float] = None
    min_items: Optional[int] = None
    barcode: Optional[str] = None
    activo: Optional[int] = None


class DescuentoOut(DescuentoCreate):
    id: int
    creado: datetime

    class Config:
        from_attributes = True


class DescuentoValidarResponse(BaseModel):
    id: int
    codigo: str
    tipo: str
    valor: float
    min_items: int
    valido: bool
    mensaje: str = ""


# ── LOGS DE AUDITORÍA ────────────────────────────────────────────────

class AuditLogOut(BaseModel):
    id: int
    usuario_id: Optional[int] = None
    username: Optional[str] = None
    accion: str
    recurso: Optional[str] = None
    recurso_id: Optional[str] = None
    detalles: Optional[dict] = None
    fecha: datetime

    class Config:
        from_attributes = True


class AuditStatsOut(BaseModel):
    total: int = 0
    logins_hoy: int = 0
    acciones_hoy: int = 0
    cambios_precio_semana: int = 0
    usuarios_activos_hoy: int = 0


class BackupInfoOut(BaseModel):
    nombre: str
    fecha: str
    tamano: str
    tamano_bytes: int


# ── GESTIÓN DE VENTAS ────────────────────────────────────────────────

class VentaDetalleOut(BaseModel):
    movimiento_id: int
    producto_id: Optional[int] = None
    producto_nombre: str
    sku: Optional[str] = ""
    variante: str = ""
    qty: int
    precio: float


class VentaAgrupadaOut(BaseModel):
    folio: str
    fecha: datetime
    canal: str
    total_estimado: float
    total_items: int
    detalles: List[VentaDetalleOut]


class DevolucionParcialItem(BaseModel):
    movimiento_id: int
    qty_a_devolver: int


class DevolucionPiezaIn(BaseModel):
    """Pieza devuelta que además se registra con diseño/foto para re-venderse."""
    movimiento_id: int
    qty: int = 1
    diseno: str
    notas: Optional[str] = ""


class DevolucionParcialRequest(BaseModel):
    folio: str
    items: List[DevolucionParcialItem]
    piezas: List[DevolucionPiezaIn] = []


# ── DEVOLUCIONES (PLAYERAS DEVUELTAS) ────────────────────────────────

class DevolucionUpdateIn(BaseModel):
    diseno: Optional[str] = None
    motivo: Optional[str] = None
    notas: Optional[str] = None
    precio: Optional[float] = None
    qty: Optional[int] = None


class DevolucionVenderIn(BaseModel):
    canal: Optional[str] = "Devolución"
    notas: Optional[str] = ""


class DevolucionDescartarIn(BaseModel):
    motivo: Optional[str] = ""


class DevolucionOut(BaseModel):
    id: int
    producto_id: Optional[int] = None
    producto_nombre: str = ""
    color: str = ""
    talla: str = ""
    variante: str = ""
    diseno: str = ""
    imagen: str = ""
    qty: int = 1
    precio: float = 0
    folio_origen: str = ""
    motivo: str = ""
    notas: str = ""
    estado: str = "disponible"
    fecha_ingreso: datetime
    fecha_salida: Optional[datetime] = None

    class Config:
        from_attributes = True


class DevolucionResumenItem(BaseModel):
    producto_id: int
    disponibles: int


class DevolucionResumenOut(BaseModel):
    items: List[DevolucionResumenItem]
    total: int


class DevolucionParcialResultOut(BaseModel):
    status: str
    mensaje: str
    devoluciones: List[DevolucionOut] = []


class DevolucionVenderOut(BaseModel):
    status: str
    mensaje: str
    folio: str
    devolucion: DevolucionOut


# ── ALERTAS INTELIGENTES ─────────────────────────────────────────────

class ProductoAlertaOut(BaseModel):
    id: int
    nombre: str
    sku: str
    categoria: str
    qty: int
    min_stock: int
    costo: float
    venta: float
    ventas_historicas: int
    total_ingresos: float


class AlertasInteligentesOut(BaseModel):
    stock_bajo_prioritario: List[ProductoAlertaOut]
    sin_stock_prioritario: List[ProductoAlertaOut]
    sin_movimiento: List[ProductoAlertaOut]


# -- CONTABILIDAD E INSUMOS -------------------------------------------

class CatalogoInsumoCreate(BaseModel):
    nombre: str
    descripcion: Optional[str] = None


class CatalogoInsumoOut(CatalogoInsumoCreate):
    id: int

    class Config:
        from_attributes = True


class ContabilidadTransaccionCreate(BaseModel):
    tipo: str
    monto: float
    fecha: datetime
    procedencia_destino: str
    concepto: str
    referencia_id: Optional[int] = None


class ContabilidadTransaccionOut(ContabilidadTransaccionCreate):
    id: int

    class Config:
        from_attributes = True

class CatalogoInsumoUpdate(BaseModel):
    nombre: Optional[str] = None
    descripcion: Optional[str] = None

