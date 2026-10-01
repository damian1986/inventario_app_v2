import json
import os
import re
import unicodedata
import uuid
from decimal import Decimal, ROUND_HALF_UP
import pyotp
from webauthn import (
    generate_registration_options,
    verify_registration_response,
    generate_authentication_options,
    verify_authentication_response,
    options_to_json,
)
from webauthn.helpers import bytes_to_base64url, base64url_to_bytes
from webauthn.helpers.structs import (
    AuthenticatorSelectionCriteria,
    PublicKeyCredentialDescriptor,
    ResidentKeyRequirement,
    UserVerificationRequirement,
)
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import delete, func
from fastapi import HTTPException
from app import models, schemas
from app.sku import generar_sku
from typing import Optional, List
from datetime import datetime, time, timedelta, timezone
from dateutil.relativedelta import relativedelta
from zoneinfo import ZoneInfo

MX_TZ = ZoneInfo("America/Mexico_City")


def _centavos(v) -> Decimal:
    """Normaliza un monto a 2 decimales con el mismo redondeo que numeric(12,2)."""
    return Decimal(str(v if v is not None else 0)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


# ── BÚSQUEDA FLEXIBLE (espejo de frontend/app.js) ────────────────────

_BUSQUEDA_STOPWORDS = {'de','del','la','el','los','las','un','una','unos','unas','y','o','con','para','por','en','al'}


def _normalizar_busqueda(texto) -> str:
    """Minúsculas y sin acentos, igual que normalizarBusqueda() del frontend."""
    return ''.join(
        c for c in unicodedata.normalize("NFD", str(texto or "").lower())
        if unicodedata.category(c) != "Mn"
    )


def _variantes_busqueda(palabra: str) -> set:
    """Tolerancia de plural y género (playeras→playera, blanca→blanco), igual que el frontend."""
    variantes = {palabra}
    if len(palabra) > 2 and palabra.endswith("s"):
        sin_s = palabra[:-1]
        variantes.add(sin_s)
        if len(sin_s) > 2 and sin_s.endswith("e"):
            variantes.add(sin_s[:-1])
    for v in list(variantes):
        if len(v) > 2:
            if v.endswith("a"):
                variantes.add(v[:-1] + "o")
            elif v.endswith("o"):
                variantes.add(v[:-1] + "a")
    return variantes


def _coincide_busqueda(campos, query: str) -> bool:
    """Todas las palabras de `query` deben aparecer en algún campo, en cualquier orden."""
    palabras = [
        w for w in _normalizar_busqueda(query).split()
        if len(w) >= 2 and w not in _BUSQUEDA_STOPWORDS
    ]
    if not palabras:
        return True
    textos = [_normalizar_busqueda(c) for c in campos if c]
    for w in palabras:
        variantes = _variantes_busqueda(w)
        if not any(any(v in t for v in variantes) for t in textos):
            return False
    return True


async def _contador_categoria(db: AsyncSession, categoria: str):
    q = await db.execute(select(models.Producto).where(models.Producto.categoria == categoria))
    return len(q.scalars().all())


# ── NOTIFICACIONES ───────────────────────────────────────────────────

async def get_notificaciones(db: AsyncSession, skip: int = 0, limit: int = 100):
    q = select(models.Notificacion).order_by(models.Notificacion.fecha.desc()).offset(skip).limit(limit)
    result = await db.execute(q)
    return result.scalars().all()


async def crear_notificacion(db: AsyncSession, mensaje: str, tipo: str = "stock_bajo", producto_id: Optional[int] = None):
    # Evitar duplicados recientes del mismo producto en alerta
    if producto_id:
        hace_poco = await db.execute(
            select(models.Notificacion)
            .where(models.Notificacion.producto_id == producto_id)
            .where(models.Notificacion.leida == 0)
        )
        if hace_poco.scalar_one_or_none():
            return None
            
    nueva = models.Notificacion(mensaje=mensaje, tipo=tipo, producto_id=producto_id)
    db.add(nueva)
    await db.commit()
    await db.refresh(nueva)
    return nueva


async def marcar_notificacion_leida(db: AsyncSession, id: int):
    q = await db.execute(select(models.Notificacion).where(models.Notificacion.id == id))
    n = q.scalar_one_or_none()
    if n:
        n.leida = 1
        await db.commit()
        await db.refresh(n)
    return n


async def limpiar_notificaciones(db: AsyncSession):
    await db.execute(delete(models.Notificacion))
    await db.commit()
    return {"status": "ok"}


async def get_productos(db: AsyncSession, skip: int = 0, limit: int = 1000):
    stmt = select(models.Producto).order_by(models.Producto.nombre).offset(skip).limit(limit)
    res = await db.execute(stmt)
    return res.scalars().all()


async def get_all_productos(db: AsyncSession):
    stmt = select(models.Producto).order_by(models.Producto.nombre)
    res = await db.execute(stmt)
    return res.scalars().all()


async def crear_producto(db: AsyncSession, data: schemas.ProductoCreate):
    nuevo = models.Producto(
        nombre=data.nombre,
        sku=data.sku,
        categoria=data.categoria,
        qty=data.qty,
        min_stock=data.min_stock,
        costo=data.costo,
        venta=data.venta,
        notas_internas=data.notas_internas,
        proveedores_alternativos=data.proveedores_alternativos,
        variantes=data.variantes
    )
    
    # Generar SKU automático si no se proporcionó
    if not nuevo.sku or not nuevo.sku.strip():
        contador = await _contador_categoria(db, nuevo.categoria)
        nuevo.sku = generar_sku(
            categoria=nuevo.categoria,
            nombre=nuevo.nombre,
            variantes=nuevo.variantes,
            contador=contador + 1,
        )

    db.add(nuevo)
    await db.flush()
    if nuevo.qty > 0:
        mov = models.Movimiento(
            tipo="entrada", producto_id=nuevo.id,
            producto_nombre=nuevo.nombre, qty=nuevo.qty,
            canal="Inventario inicial"
        )
        db.add(mov)
    await db.commit()
    await db.refresh(nuevo)
    return nuevo


async def get_producto(db: AsyncSession, id: int):
    p = await db.get(models.Producto, id)
    if not p:
        raise HTTPException(404, "Producto no encontrado")
    return p


async def actualizar_producto(db: AsyncSession, id: int, data: schemas.ProductoUpdate):
    p = await get_producto(db, id)
    datos = data.model_dump(exclude_unset=True)

    # Regenerar SKU si se dejó vacío al editar
    if "sku" in datos and (not datos["sku"] or not datos["sku"].strip()):
        contador = await _contador_categoria(db, datos.get("categoria", p.categoria))
        datos["sku"] = generar_sku(
            categoria=datos.get("categoria", p.categoria),
            nombre=datos.get("nombre", p.nombre),
            variantes=datos.get("variantes", p.variantes),
            contador=contador,
        )

    # Detectar cambios en costo y venta
    costo_anterior = p.costo
    venta_anterior = p.venta
    hay_cambio_precio = False

    for k, v in datos.items():
        setattr(p, k, v)
        
    if "costo" in datos and _centavos(datos["costo"]) != _centavos(costo_anterior):
        hay_cambio_precio = True
    if "venta" in datos and _centavos(datos["venta"]) != _centavos(venta_anterior):
        hay_cambio_precio = True
        
    if hay_cambio_precio:
        hp = models.HistorialPrecio(
            producto_id=p.id,
            costo_anterior=costo_anterior,
            costo_nuevo=p.costo,
            venta_anterior=venta_anterior,
            venta_nuevo=p.venta
        )
        db.add(hp)

    await db.commit()
    await db.refresh(p)
    return p


async def get_historial_precios(db: AsyncSession, producto_id: int):
    stmt = select(models.HistorialPrecio).where(models.HistorialPrecio.producto_id == producto_id).order_by(models.HistorialPrecio.fecha.desc())
    res = await db.execute(stmt)
    return res.scalars().all()


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
    
    # Notificación si baja de stock
    if p.qty <= p.min_stock:
        await crear_notificacion(db, f"Stock bajo en {p.nombre}: {p.qty} unidades", "stock_bajo", p.id)
        
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
    
    # Notificación si baja de stock
    if p.qty <= p.min_stock:
        await crear_notificacion(db, f"Stock bajo en {p.nombre}: {p.qty} unidades", "stock_bajo", p.id)
        
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


# ── DESCUENTOS ───────────────────────────────────────────────────────

async def get_descuentos(db: AsyncSession, skip: int = 0, limit: int = 100):
    stmt = select(models.Descuento).order_by(models.Descuento.creado.desc()).offset(skip).limit(limit)
    res = await db.execute(stmt)
    return res.scalars().all()


async def crear_descuento(db: AsyncSession, data: schemas.DescuentoCreate):
    # Verificar si el código ya existe
    stmt = select(models.Descuento).where(models.Descuento.codigo == data.codigo)
    res = await db.execute(stmt)
    if res.scalar_one_or_none():
        raise HTTPException(400, "El código de descuento ya existe")
        
    nuevo = models.Descuento(**data.model_dump())
    db.add(nuevo)
    await db.commit()
    await db.refresh(nuevo)
    return nuevo


async def actualizar_descuento(db: AsyncSession, id: int, data: schemas.DescuentoUpdate):
    d = await db.get(models.Descuento, id)
    if not d:
        raise HTTPException(404, "Descuento no encontrado")
    
    datos = data.model_dump(exclude_unset=True)
    for k, v in datos.items():
        setattr(d, k, v)
        
    await db.commit()
    await db.refresh(d)
    return d


async def eliminar_descuento(db: AsyncSession, id: int):
    d = await db.get(models.Descuento, id)
    if not d:
        raise HTTPException(404, "Descuento no encontrado")
    await db.delete(d)
    await db.commit()
    return True


async def validar_descuento(db: AsyncSession, codigo: str, total_items: int):
    # Buscar por código o por barcode
    stmt = select(models.Descuento).where(
        (models.Descuento.codigo == codigo) | (models.Descuento.barcode == codigo)
    )
    res = await db.execute(stmt)
    d = res.scalar_one_or_none()
    
    if not d:
        return schemas.DescuentoValidarResponse(
            id=0, codigo=codigo, tipo="", valor=0, min_items=0,
            valido=False, mensaje="Código no encontrado"
        )
        
    if not d.activo:
        return schemas.DescuentoValidarResponse(
            id=d.id, codigo=d.codigo, tipo=d.tipo, valor=d.valor, min_items=d.min_items,
            valido=False, mensaje="El cupón está inactivo"
        )
        
    if total_items < d.min_items:
        return schemas.DescuentoValidarResponse(
            id=d.id, codigo=d.codigo, tipo=d.tipo, valor=d.valor, min_items=d.min_items,
            valido=False, mensaje=f"Se requieren al menos {d.min_items} productos"
        )
        
    return schemas.DescuentoValidarResponse(
        id=d.id, codigo=d.codigo, tipo=d.tipo, valor=d.valor, min_items=d.min_items,
        valido=True, mensaje="Cupón aplicado correctamente"
    )


# ── AUTENTICACIÓN / USUARIOS ──────────────────────────────────────────────────

def validar_password(password: str):
    if len(password) < 8 or len(password) > 30:
        raise HTTPException(status_code=400, detail="La contraseña debe tener entre 8 y 30 caracteres")
    if not re.search(r"[A-Za-z]", password):
        raise HTTPException(status_code=400, detail="La contraseña debe contener al menos una letra")
    if not re.search(r"\d", password):
        raise HTTPException(status_code=400, detail="La contraseña debe contener al menos un número")
    if not re.search(r"[!@#$%^&*(),.?\":{}|<>\-_]", password):
        raise HTTPException(status_code=400, detail="La contraseña debe contener al menos un carácter especial")

async def autenticar_usuario(db: AsyncSession, username: str, password: str):
    """Valida credenciales. Retorna el objeto Usuario o None."""
    from app.auth import verify_password
    result = await db.execute(
        select(models.Usuario).where(models.Usuario.username == username)
    )
    user = result.scalar_one_or_none()
    if user is None or user.activo == 0:
        return None
    if not verify_password(password, user.password_hash):
        return None
    return user


async def crear_usuario(db: AsyncSession, data: schemas.UsuarioCreate) -> models.Usuario:
    """Crea un nuevo usuario con contraseña hasheada."""
    from app.auth import hash_password

    # Verificar que el username no exista
    result = await db.execute(
        select(models.Usuario).where(models.Usuario.username == data.username)
    )
    if result.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="El nombre de usuario ya existe")

    roles_validos = ("admin", "vendedor", "bodeguero")
    if data.rol not in roles_validos:
        raise HTTPException(status_code=400, detail=f"Rol inválido. Opciones: {', '.join(roles_validos)}")

    validar_password(data.password)

    user = models.Usuario(
        username=data.username,
        nombre=data.nombre,
        email=data.email,
        password_hash=hash_password(data.password),
        rol=data.rol,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


async def listar_usuarios(db: AsyncSession):
    """Lista todos los usuarios."""
    result = await db.execute(select(models.Usuario).order_by(models.Usuario.id))
    return result.scalars().all()


async def actualizar_usuario(db: AsyncSession, id: int, data: schemas.UsuarioUpdate) -> models.Usuario:
    """Actualiza datos de un usuario (rol, password, activo)."""
    from app.auth import hash_password
    user = await db.get(models.Usuario, id)
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")

    datos = data.model_dump(exclude_unset=True)
    if "password" in datos and datos["password"]:
        validar_password(datos["password"])
        user.password_hash = hash_password(datos["password"])
    
    if "rol" in datos:
        roles_validos = ("admin", "vendedor", "bodeguero")
        if datos["rol"] not in roles_validos:
            raise HTTPException(status_code=400, detail="Rol inválido")
        user.rol = datos["rol"]
    
    if "activo" in datos:
        user.activo = datos["activo"]

    if "email" in datos:
        user.email = datos["email"]

    if "nombre" in datos:
        user.nombre = datos["nombre"] or ""

    await db.commit()
    await db.refresh(user)
    return user


async def preparar_setup_totp(db: AsyncSession, user_id: int):
    user = await db.get(models.Usuario, user_id)
    if not user: raise HTTPException(404, "Usuario no encontrado")
    secret = pyotp.random_base32()
    user.totp_secret = secret
    await db.commit()
    uri = pyotp.totp.TOTP(secret).provisioning_uri(name=user.username, issuer_name="Inventario Pro")
    return {"secret": secret, "provisioning_uri": uri}


async def activar_totp(db: AsyncSession, user_id: int, code: str):
    user = await db.get(models.Usuario, user_id)
    if not user or not user.totp_secret: return False
    if pyotp.TOTP(user.totp_secret).verify(code, valid_window=2):
        user.totp_enabled = 1
        await db.commit()
        return True
    return False


async def verificar_login_totp(db: AsyncSession, username: str, code: str):
    q = await db.execute(select(models.Usuario).where(models.Usuario.username == username))
    user = q.scalar_one_or_none()
    if not user or not user.totp_enabled or not user.totp_secret: return False
    return pyotp.TOTP(user.totp_secret).verify(code, valid_window=2)


async def desactivar_totp_usuario(db: AsyncSession, user_id: int):
    user = await db.get(models.Usuario, user_id)
    if user:
        user.totp_enabled = 0
        user.totp_secret = None
        await db.commit()
        return True
    return False


# ── PASSKEYS / WEBAUTHN (segundo factor tras la contraseña) ──────────
# La llave PRIVADA nunca sale del dispositivo del usuario (Windows Hello,
# huella/PIN, llave USB). El servidor solo guarda la llave PÚBLICA.
# El reto (challenge) se genera aquí y se conserva en memoria 5 minutos;
# es válido porque la API corre con un solo proceso de uvicorn
# (ver command en docker-compose.yml). Si algún día se usan varios
# workers, habría que moverlo a la base de datos o a Redis.

_WEBAUTHN_RETO_MINUTOS = 5
_retos_registro: dict = {}   # user_id  -> (challenge: bytes, expira: datetime UTC)
_retos_login: dict = {}      # username -> (challenge: bytes, expira: datetime UTC)


def webauthn_config():
    """Configuración del Relying Party (RP).

    Por defecto funciona en el entorno local (http://localhost:3000).
    En el VPS con HTTPS definir WEBAUTHN_RP_ID (dominio) y WEBAUTHN_ORIGIN
    (https://dominio; admite varios separados por coma).
    """
    rp_id = os.getenv("WEBAUTHN_RP_ID", "localhost")
    rp_name = os.getenv("WEBAUTHN_RP_NAME", "Inventario Pro")
    origins = [o.strip() for o in os.getenv("WEBAUTHN_ORIGIN", "http://localhost:3000").split(",") if o.strip()]
    return rp_id, rp_name, origins


def _limpiar_retos():
    """Descarta retos caducados (higiene simple del diccionario en memoria)."""
    ahora = datetime.now(timezone.utc)
    for d in (_retos_registro, _retos_login):
        for k in [k for k, (_, exp) in d.items() if exp < ahora]:
            d.pop(k, None)


def _norm_b64(s: str) -> str:
    """Forma canónica de la WebAuthn: base64url sin relleno '='."""
    return (s or "").rstrip("=")


async def usuario_tiene_passkeys(db: AsyncSession, user_id: int) -> bool:
    q = await db.execute(
        select(models.WebAuthnCredential.id)
        .where(models.WebAuthnCredential.usuario_id == user_id)
        .limit(1)
    )
    return q.scalar_one_or_none() is not None


async def webauthn_opciones_registro(db: AsyncSession, user: models.Usuario):
    """Paso 1 del registro: opciones para navigator.credentials.create()."""
    rp_id, rp_name, _ = webauthn_config()
    q = await db.execute(
        select(models.WebAuthnCredential).where(models.WebAuthnCredential.usuario_id == user.id)
    )
    existentes = q.scalars().all()

    opciones = generate_registration_options(
        rp_id=rp_id,
        rp_name=rp_name,
        user_id=f"inv-{user.id}".encode(),
        user_name=user.username,
        user_display_name=user.nombre or user.username,
        authenticator_selection=AuthenticatorSelectionCriteria(
            user_verification=UserVerificationRequirement.REQUIRED,
            resident_key=ResidentKeyRequirement.PREFERRED,
        ),
        exclude_credentials=[
            PublicKeyCredentialDescriptor(id=base64url_to_bytes(c.credential_id))
            for c in existentes
        ] or None,
    )
    _limpiar_retos()
    _retos_registro[user.id] = (
        opciones.challenge,
        datetime.now(timezone.utc) + timedelta(minutes=_WEBAUTHN_RETO_MINUTOS),
    )
    return json.loads(options_to_json(opciones))


async def webauthn_verificar_registro(
    db: AsyncSession, user: models.Usuario, credencial: dict, nombre: Optional[str] = None
):
    """Paso 2 del registro: verifica la respuesta y guarda la llave pública."""
    rp_id, _, origins = webauthn_config()

    reto = _retos_registro.pop(user.id, None)
    if not reto:
        raise HTTPException(400, "No hay un registro de passkey en curso. Inténtalo de nuevo.")
    challenge, expira = reto
    if expira < datetime.now(timezone.utc):
        raise HTTPException(400, "El registro expiró. Inténtalo de nuevo.")

    try:
        verificada = verify_registration_response(
            credential=credencial,
            expected_challenge=challenge,
            expected_rp_id=rp_id,
            expected_origin=origins,
            require_user_verification=True,
        )
    except Exception as e:
        raise HTTPException(400, f"Registro de passkey inválido: {e}")

    cred_id = _norm_b64(bytes_to_base64url(verificada.credential_id))
    q = await db.execute(
        select(models.WebAuthnCredential).where(models.WebAuthnCredential.credential_id == cred_id)
    )
    if q.scalar_one_or_none():
        raise HTTPException(400, "Esta passkey ya está registrada.")

    transports = credencial.get("response", {}).get("transports") or []
    fila = models.WebAuthnCredential(
        usuario_id=user.id,
        credential_id=cred_id,
        public_key=bytes_to_base64url(verificada.credential_public_key),
        sign_count=verificada.sign_count or 0,
        transports=",".join(t for t in transports if isinstance(t, str)),
        nombre=(nombre or "Passkey").strip()[:100],
    )
    db.add(fila)
    await db.commit()
    await db.refresh(fila)
    return fila


async def webauthn_opciones_login(db: AsyncSession, user: models.Usuario):
    """Paso 1 del 2.º factor con passkey: opciones para navigator.credentials.get()."""
    rp_id, _, _ = webauthn_config()
    q = await db.execute(
        select(models.WebAuthnCredential).where(models.WebAuthnCredential.usuario_id == user.id)
    )
    creds = q.scalars().all()
    if not creds:
        raise HTTPException(400, "Este usuario no tiene passkeys registradas.")

    opciones = generate_authentication_options(
        rp_id=rp_id,
        allow_credentials=[
            PublicKeyCredentialDescriptor(id=base64url_to_bytes(c.credential_id)) for c in creds
        ],
        user_verification=UserVerificationRequirement.REQUIRED,
    )
    _limpiar_retos()
    _retos_login[user.username] = (
        opciones.challenge,
        datetime.now(timezone.utc) + timedelta(minutes=_WEBAUTHN_RETO_MINUTOS),
    )
    return json.loads(options_to_json(opciones))


async def webauthn_verificar_login(db: AsyncSession, username: str, credencial: dict):
    """Paso 2 del 2.º factor: verifica la firma de navigator.credentials.get().

    Devuelve True si la firma es válida. La contraseña ya se validó en
    /auth/login, así que esto es el segundo factor (posesión + huella/PIN).
    """
    rp_id, _, origins = webauthn_config()

    reto = _retos_login.pop(username, None)
    if not reto:
        raise HTTPException(400, "No hay una verificación con passkey en curso. Inténtalo de nuevo.")
    challenge, expira = reto
    if expira < datetime.now(timezone.utc):
        raise HTTPException(400, "La verificación expiró. Inténtalo de nuevo.")

    cred_id = _norm_b64(str(credencial.get("id") or ""))
    q = await db.execute(
        select(models.WebAuthnCredential).where(models.WebAuthnCredential.credential_id == cred_id)
    )
    fila = q.scalar_one_or_none()
    if not fila:
        raise HTTPException(401, "Passkey desconocida para este usuario.")

    # La credencial debe pertenecer exactamente al usuario del token temporal
    q = await db.execute(select(models.Usuario).where(models.Usuario.id == fila.usuario_id))
    dueno = q.scalar_one_or_none()
    if not dueno or dueno.username != username:
        raise HTTPException(401, "La passkey no pertenece a este usuario.")

    try:
        verificada = verify_authentication_response(
            credential=credencial,
            expected_challenge=challenge,
            expected_rp_id=rp_id,
            expected_origin=origins,
            credential_public_key=base64url_to_bytes(fila.public_key),
            credential_current_sign_count=fila.sign_count or 0,
            require_user_verification=True,
        )
    except Exception as e:
        raise HTTPException(401, f"Verificación de passkey fallida: {e}")

    # Contador anti-clonación: si retrocede (con ambos valores > 0) la
    # credencial pudo ser copiada (authenticator clonado). Se rechaza.
    nuevo_conteo = verificada.new_sign_count or 0
    if (fila.sign_count or 0) > 0 and nuevo_conteo > 0 and nuevo_conteo <= fila.sign_count:
        raise HTTPException(401, "Contador de la passkey inconsistente (posible copia). Contáctanos.")

    fila.sign_count = max(nuevo_conteo, fila.sign_count or 0)
    fila.ultimo_uso = datetime.now(timezone.utc)
    await db.commit()
    return True


async def listar_passkeys(db: AsyncSession, user_id: int):
    q = await db.execute(
        select(models.WebAuthnCredential)
        .where(models.WebAuthnCredential.usuario_id == user_id)
        .order_by(models.WebAuthnCredential.id)
    )
    return q.scalars().all()


async def eliminar_passkey(db: AsyncSession, user_id: int, cred_id: int):
    q = await db.execute(
        select(models.WebAuthnCredential).where(
            models.WebAuthnCredential.id == cred_id,
            models.WebAuthnCredential.usuario_id == user_id,
        )
    )
    fila = q.scalar_one_or_none()
    if not fila:
        raise HTTPException(404, "Passkey no encontrada")
    await db.delete(fila)
    await db.commit()
    return True


async def eliminar_usuario(db: AsyncSession, id: int):
    """Elimina permanentemente un usuario."""
    user = await db.get(models.Usuario, id)
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    await db.delete(user)
    await db.commit()
    return True


async def seed_admin_if_empty(db: AsyncSession):
    """Si no hay usuarios en la BD, crea el admin por defecto.

    La contraseña inicial se toma de ADMIN_INITIAL_PASSWORD; si no está
    definida, se genera una aleatoria y se imprime una única vez.
    """
    import secrets
    from app.auth import hash_password
    result = await db.execute(select(models.Usuario).limit(1))
    if result.scalar_one_or_none() is None:
        password = os.getenv("ADMIN_INITIAL_PASSWORD") or secrets.token_urlsafe(16)
        admin = models.Usuario(
            username="admin",
            nombre="Administrador Principal",
            email="admin@inventario.pro",
            password_hash=hash_password(password),
            rol="admin",
            activo=1,
        )
        db.add(admin)
        await db.commit()
        print("=" * 55)
        print("  USUARIO ADMIN CREADO AUTOMÁTICAMENTE")
        print("  Usuario:    admin")
        if os.getenv("ADMIN_INITIAL_PASSWORD"):
            print("  Contraseña: (la definida en ADMIN_INITIAL_PASSWORD)")
        else:
            print(f"  Contraseña temporal: {password}")
            print("  ⚠️  GUÁRDALA AHORA — no se volverá a mostrar. Cámbiala al entrar.")
        print("=" * 55)


# ── LOGS DE AUDITORÍA ────────────────────────────────────────────────

async def registrar_log(
    db: AsyncSession,
    usuario_id: Optional[int],
    username: Optional[str],
    accion: str,
    recurso: Optional[str] = None,
    recurso_id: Optional[str] = None,
    detalles: Optional[dict] = None
):
    """Crea un registro en el log de auditoría."""
    log = models.AuditLog(
        usuario_id=usuario_id,
        username=username,
        accion=accion,
        recurso=recurso,
        recurso_id=recurso_id,
        detalles=detalles
    )
    db.add(log)
    await db.commit()
    return log


async def get_audit_logs(
    db: AsyncSession,
    usuario_id: Optional[int] = None,
    accion: Optional[str] = None,
    desde: Optional[str] = None,
    hasta: Optional[str] = None,
    skip: int = 0,
    limit: int = 200
):
    """Recupera los logs de auditoría con filtros opcionales."""
    stmt = select(models.AuditLog).order_by(models.AuditLog.fecha.desc())
    
    if usuario_id:
        stmt = stmt.filter(models.AuditLog.usuario_id == usuario_id)
    
    if accion:
        stmt = stmt.filter(models.AuditLog.accion == accion)
    
    if desde:
        try:
            desde_dt = datetime.strptime(desde, "%Y-%m-%d")
            stmt = stmt.filter(models.AuditLog.fecha >= desde_dt)
        except ValueError:
            pass
            
    if hasta:
        try:
            # Fin del día hasta las 23:59:59
            hasta_dt = datetime.combine(datetime.strptime(hasta, "%Y-%m-%d"), time(23, 59, 59))
            stmt = stmt.filter(models.AuditLog.fecha <= hasta_dt)
        except ValueError:
            pass
            
    stmt = stmt.offset(skip).limit(limit)
    res = await db.execute(stmt)
    return res.scalars().all()


async def get_audit_stats(db: AsyncSession):
    """Retorna conteos estadísticos rápidos del audit log."""
    from sqlalchemy import func as sqlfunc
    
    hoy = datetime.now(MX_TZ).date()
    hoy_inicio = datetime.combine(hoy, time(0, 0, 0))
    semana_inicio = hoy_inicio - timedelta(days=7)
    
    # Total de logs
    total_q = await db.execute(select(sqlfunc.count(models.AuditLog.id)))
    total = total_q.scalar() or 0
    
    # Logins de hoy
    logins_hoy_q = await db.execute(
        select(sqlfunc.count(models.AuditLog.id))
        .where(models.AuditLog.accion == "LOGIN")
        .where(models.AuditLog.fecha >= hoy_inicio)
    )
    logins_hoy = logins_hoy_q.scalar() or 0
    
    # Acciones de hoy
    acciones_hoy_q = await db.execute(
        select(sqlfunc.count(models.AuditLog.id))
        .where(models.AuditLog.fecha >= hoy_inicio)
    )
    acciones_hoy = acciones_hoy_q.scalar() or 0
    
    # Cambios de precio esta semana
    cambios_precio_q = await db.execute(
        select(sqlfunc.count(models.AuditLog.id))
        .where(models.AuditLog.accion == "EDITAR_PRODUCTO")
        .where(models.AuditLog.fecha >= semana_inicio)
    )
    cambios_precio_semana = cambios_precio_q.scalar() or 0
    
    # Usuarios activos hoy (distintos)
    usuarios_activos_q = await db.execute(
        select(sqlfunc.count(sqlfunc.distinct(models.AuditLog.usuario_id)))
        .where(models.AuditLog.fecha >= hoy_inicio)
    )
    usuarios_activos_hoy = usuarios_activos_q.scalar() or 0
    
    return schemas.AuditStatsOut(
        total=total,
        logins_hoy=logins_hoy,
        acciones_hoy=acciones_hoy,
        cambios_precio_semana=cambios_precio_semana,
        usuarios_activos_hoy=usuarios_activos_hoy,
    )


# ── RESPALDO DE BASE DE DATOS ────────────────────────────────────────

import asyncio
import os
import glob

BACKUP_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "backups")
if not os.path.isdir(BACKUP_DIR):
    # Dentro del contenedor Docker, /app/backups
    BACKUP_DIR = "/app/backups"

MAX_BACKUPS = 7


async def crear_backup_db() -> Optional[str]:
    """Ejecuta pg_dump y retorna el path del archivo generado."""
    os.makedirs(BACKUP_DIR, exist_ok=True)
    
    db_url = os.getenv("DATABASE_URL", "")
    # Extraer credenciales de la URL
    # postgresql+asyncpg://user:pass@host:port/dbname
    try:
        parts = db_url.replace("postgresql+asyncpg://", "").replace("postgresql://", "")
        user_pass, host_db = parts.split("@")
        user, password = user_pass.split(":")
        host_port, dbname = host_db.split("/")
        host = host_port.split(":")[0]
        port = host_port.split(":")[1] if ":" in host_port else "5432"
    except Exception:
        # Fallback a variables de entorno
        user = os.getenv("POSTGRES_USER", "inventario")
        password = os.getenv("POSTGRES_PASSWORD")
        if not password:
            print("[BACKUP ERROR] Sin contraseña de BD disponible: revisa DATABASE_URL o POSTGRES_PASSWORD.")
            return None
        host = "db"
        port = "5432"
        dbname = os.getenv("POSTGRES_DB", "inventario_db")
    
    timestamp = datetime.now(MX_TZ).strftime("%Y%m%d_%H%M%S")
    filename = f"backup_{timestamp}.sql"
    filepath = os.path.join(BACKUP_DIR, filename)
    
    env = os.environ.copy()
    env["PGPASSWORD"] = password
    
    cmd = [
        "pg_dump",
        "-h", host,
        "-p", port,
        "-U", user,
        "-d", dbname,
        "-f", filepath,
        "-w", # Force no password prompt
        "--no-owner",
        "--no-privileges",
    ]
    
    try:
        process = await asyncio.create_subprocess_exec(
            *cmd,
            env=env,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        _, stderr = await process.communicate()
        if process.returncode != 0:
            error_msg = stderr.decode() if stderr else "Error desconocido en pg_dump"
            print(f"[BACKUP ERROR] Código {process.returncode}: {error_msg}")
            # Si el archivo se creó pero está vacío por error, borrarlo
            if os.path.exists(filepath):
                os.remove(filepath)
            return None
        
        print(f"[BACKUP OK] Respaldo creado: {filepath}")
        # Limpiar backups antiguos
        await limpiar_backups_antiguos()
        return filepath
    except FileNotFoundError:
        print("[BACKUP ERROR] pg_dump no encontrado. Instalar postgresql-client en el contenedor.")
        return None
    except Exception as e:
        print(f"[BACKUP ERROR] {e}")
        return None


async def limpiar_backups_antiguos():
    """Elimina los backups más antiguos si hay más de MAX_BACKUPS."""
    try:
        archivos = sorted(glob.glob(os.path.join(BACKUP_DIR, "backup_*.sql")))
        while len(archivos) > MAX_BACKUPS:
            oldest = archivos.pop(0)
            os.remove(oldest)
            print(f"[BACKUP CLEANUP] Eliminado backup antiguo: {oldest}")
    except Exception as e:
        print(f"[BACKUP CLEANUP ERROR] {e}")


def listar_backups() -> list:
    """Lista todos los archivos de backup disponibles."""
    os.makedirs(BACKUP_DIR, exist_ok=True)
    archivos = sorted(glob.glob(os.path.join(BACKUP_DIR, "backup_*.sql")), reverse=True)
    result = []
    for path in archivos:
        stat = os.stat(path)
        size_mb = stat.st_size / (1024 * 1024)
        tamano = f"{size_mb:.2f} MB" if size_mb >= 1 else f"{stat.st_size / 1024:.1f} KB"
        # Extraer fecha del nombre
        basename = os.path.basename(path)
        try:
            date_part = basename.replace("backup_", "").replace(".sql", "")
            fecha_dt = datetime.strptime(date_part, "%Y%m%d_%H%M%S")
            fecha_str = fecha_dt.strftime("%d/%m/%Y %H:%M:%S")
        except Exception:
            fecha_str = datetime.fromtimestamp(stat.st_mtime).strftime("%d/%m/%Y %H:%M:%S")
        
        result.append(schemas.BackupInfoOut(
            nombre=basename,
            fecha=fecha_str,
            tamano=tamano,
            tamano_bytes=stat.st_size,
        ))
    return result


async def restaurar_backup_db(nombre_archivo: str) -> bool:
    """Restaura la base de datos desde un archivo de backup.
    
    PROCESO SEGURO:
    1. Verifica que el archivo existe
    2. Crea un backup de seguridad previo (pre_restore_*)
    3. Ejecuta psql para restaurar el dump SQL
    """
    filepath = os.path.join(BACKUP_DIR, nombre_archivo)
    if not os.path.isfile(filepath):
        print(f"[RESTORE ERROR] Archivo no encontrado: {filepath}")
        return False
    
    # 1. Extraer credenciales de BD
    db_url = os.getenv("DATABASE_URL", "")
    try:
        parts = db_url.replace("postgresql+asyncpg://", "").replace("postgresql://", "")
        user_pass, host_db = parts.split("@")
        user, password = user_pass.split(":")
        host_port, dbname = host_db.split("/")
        host = host_port.split(":")[0]
        port = host_port.split(":")[1] if ":" in host_port else "5432"
    except Exception:
        user = os.getenv("POSTGRES_USER", "inventario")
        password = os.getenv("POSTGRES_PASSWORD")
        if not password:
            print("[BACKUP ERROR] Sin contraseña de BD disponible: revisa DATABASE_URL o POSTGRES_PASSWORD.")
            return False
        host = "db"
        port = "5432"
        dbname = os.getenv("POSTGRES_DB", "inventario_db")
    
    env = os.environ.copy()
    env["PGPASSWORD"] = password
    
    # 2. Crear backup de seguridad antes de restaurar
    timestamp = datetime.now(MX_TZ).strftime("%Y%m%d_%H%M%S")
    safety_file = os.path.join(BACKUP_DIR, f"pre_restore_{timestamp}.sql")
    safety_cmd = [
        "pg_dump", "-h", host, "-p", port, "-U", user, "-d", dbname,
        "-f", safety_file, "--no-owner", "--no-privileges",
    ]
    try:
        proc = await asyncio.create_subprocess_exec(
            *safety_cmd, env=env,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        )
        await proc.communicate()
        if proc.returncode == 0:
            print(f"[RESTORE] Backup de seguridad creado: {safety_file}")
        else:
            print("[RESTORE WARNING] No se pudo crear backup de seguridad, continuando...")
    except Exception as e:
        print(f"[RESTORE WARNING] Fallo backup de seguridad: {e}")
    
    # 3. Limpiar la base de datos y restaurar
    # Primero: eliminar todas las tablas (DROP SCHEMA public CASCADE + CREATE SCHEMA)
    drop_cmd = [
        "psql", "-h", host, "-p", port, "-U", user, "-d", dbname,
        "-c", "DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO public;",
    ]
    try:
        proc = await asyncio.create_subprocess_exec(
            *drop_cmd, env=env,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        )
        _, stderr = await proc.communicate()
        if proc.returncode != 0:
            error_msg = stderr.decode() if stderr else "Error desconocido"
            print(f"[RESTORE ERROR] Falló limpiar la BD: {error_msg}")
            return False
        print("[RESTORE] Base de datos limpiada correctamente")
    except Exception as e:
        print(f"[RESTORE ERROR] {e}")
        return False
    
    # Segundo: restaurar desde el archivo SQL
    restore_cmd = [
        "psql", "-h", host, "-p", port, "-U", user, "-d", dbname,
        "-f", filepath,
    ]
    try:
        proc = await asyncio.create_subprocess_exec(
            *restore_cmd, env=env,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        )
        _, stderr = await proc.communicate()
        if proc.returncode != 0:
            error_msg = stderr.decode() if stderr else "Error desconocido"
            print(f"[RESTORE ERROR] Falló la restauración: {error_msg}")
            return False
        
        print(f"[RESTORE OK] Base de datos restaurada desde: {nombre_archivo}")
        return True
    except Exception as e:
        print(f"[RESTORE ERROR] {e}")
        return False


# ── GESTIÓN DE VENTAS ────────────────────────────────────────────────

async def get_ventas_agrupadas(
    db: AsyncSession,
    desde: Optional[str] = None,
    hasta: Optional[str] = None,
    canal: Optional[str] = None,
    query: Optional[str] = None,
    skip: int = 0,
    limit: int = 100
):
    from sqlalchemy import select
    import re
    from datetime import time

    stmt = (
        select(models.Movimiento, models.Producto.sku)
        .outerjoin(models.Producto, models.Movimiento.producto_id == models.Producto.id)
        .where(models.Movimiento.tipo == "venta")
        # desempate por id: orden estable para la paginación por folios
        .order_by(models.Movimiento.fecha.desc(), models.Movimiento.id.desc())
    )

    if canal and canal != "Todos" and canal != "":
        stmt = stmt.where(models.Movimiento.canal == canal)

    if desde:
        try:
            desde_dt = datetime.strptime(desde, "%Y-%m-%d")
            stmt = stmt.where(models.Movimiento.fecha >= desde_dt)
        except ValueError:
            pass

    if hasta:
        try:
            hasta_dt = datetime.combine(datetime.strptime(hasta, "%Y-%m-%d"), time(23, 59, 59))
            stmt = stmt.where(models.Movimiento.fecha <= hasta_dt)
        except ValueError:
            pass

    res = await db.execute(stmt)
    rows = res.all()

    # Group by folio
    groups = {}
    
    for mov, sku in rows:
        folio = str(mov.id)
        notas_str = mov.notas or ""
        if notas_str:
            parts = notas_str.split(' | ')
            potential_folio = parts[0].split(' ')[0]
            if re.match(r'^\d{8}-', potential_folio) or potential_folio.startswith('TICKET-'):
                folio = potential_folio

        if folio not in groups:
            groups[folio] = {
                "folio": folio,
                "fecha": mov.fecha,
                "canal": mov.canal or "Venta directa",
                "total_estimado": Decimal("0"),
                "total_items": 0,
                "detalles": []
            }
        
        groups[folio]["detalles"].append({
            "movimiento_id": mov.id,
            "producto_id": mov.producto_id,
            "producto_nombre": mov.producto_nombre,
            "sku": sku or "",
            "variante": mov.variante or "",
            "qty": mov.qty,
            "precio": mov.precio
        })
        groups[folio]["total_estimado"] += mov.precio * mov.qty
        groups[folio]["total_items"] += mov.qty

    grouped_list = list(groups.values())

    if query:
        grouped_list = [
            g for g in grouped_list
            if _coincide_busqueda(
                [g["folio"], g["canal"]]
                + [d["producto_nombre"] for d in g["detalles"]]
                + [d["sku"] for d in g["detalles"]],
                query,
            )
        ]

    return grouped_list[skip : skip + limit]


async def procesar_devolucion_parcial(
    db: AsyncSession,
    folio: str,
    items: List[schemas.DevolucionParcialItem],
    usuario_id: Optional[int] = None,
    username: Optional[str] = None,
    piezas: Optional[List[schemas.DevolucionPiezaIn]] = None
):
    import re

    # Piezas que además se registran para reventa (con diseño), agrupadas por movimiento de origen
    por_movimiento: dict = {}
    for pieza in (piezas or []):
        if pieza.qty < 1:
            raise HTTPException(status_code=400, detail="Cada pieza registrada debe tener cantidad mayor a 0")
        if not (pieza.diseno or "").strip():
            raise HTTPException(status_code=400, detail="Cada pieza registrada requiere diseño")
        por_movimiento.setdefault(pieza.movimiento_id, []).append(pieza)

    ids_items = {item.movimiento_id for item in items}
    for mov_id in por_movimiento:
        if mov_id not in ids_items:
            raise HTTPException(status_code=400, detail=f"El movimiento {mov_id} de las piezas no está en la devolución")

    creadas: List[models.Devolucion] = []

    for item in items:
        m = await db.get(models.Movimiento, item.movimiento_id)
        if not m:
            raise HTTPException(status_code=404, detail=f"Movimiento con ID {item.movimiento_id} no encontrado")
        
        if m.tipo != "venta":
            raise HTTPException(status_code=400, detail="Solo se pueden realizar devoluciones de movimientos de tipo venta")
        
        mov_folio = str(m.id)
        if m.notas:
            parts = m.notas.split(' | ')
            potential_folio = parts[0].split(' ')[0]
            if re.match(r'^\d{8}-', potential_folio) or potential_folio.startswith('TICKET-'):
                mov_folio = potential_folio
        
        if mov_folio != folio:
            raise HTTPException(status_code=400, detail=f"El movimiento {m.id} no pertenece al folio {folio}")
            
        if item.qty_a_devolver <= 0:
            raise HTTPException(status_code=400, detail="La cantidad a devolver debe ser mayor a 0")
            
        if item.qty_a_devolver > m.qty:
            raise HTTPException(status_code=400, detail=f"Cantidad a devolver ({item.qty_a_devolver}) excede la cantidad vendida ({m.qty}) para {m.producto_nombre}")

        piezas_mov = por_movimiento.get(item.movimiento_id, [])
        if sum(p.qty for p in piezas_mov) > item.qty_a_devolver:
            raise HTTPException(status_code=400, detail=f"Las piezas a registrar superan la cantidad devuelta de {m.producto_nombre}")

        # Datos del movimiento ANTES de modificarlo/eliminarlo
        color, talla = _parsear_variante_producto(m.producto_nombre or "")
        datos_pieza = {
            "producto_id": m.producto_id,
            "producto_nombre": m.producto_nombre or "",
            "color": color,
            "talla": talla,
            "variante": m.variante or "",
            "precio": float(m.precio or 0),
        }

        if m.producto_id:
            p = await db.get(models.Producto, m.producto_id)
            if p:
                p.qty += item.qty_a_devolver
        
        orig_qty = m.qty
        if item.qty_a_devolver == m.qty:
            await db.delete(m)
            # La venta de esta línea se revirtió por completo: las piezas vendidas
            # desde este folio vuelven a estar disponibles
            await _restaurar_piezas_vendidas(db, folio)
        else:
            m.qty -= item.qty_a_devolver

        for pieza in piezas_mov:
            d = models.Devolucion(
                producto_id=datos_pieza["producto_id"],
                producto_nombre=datos_pieza["producto_nombre"],
                color=datos_pieza["color"],
                talla=datos_pieza["talla"],
                variante=datos_pieza["variante"],
                diseno=pieza.diseno.strip(),
                notas=(pieza.notas or "").strip(),
                qty=pieza.qty,
                precio=_centavos(datos_pieza["precio"]),
                folio_origen=folio,
                estado="disponible",
            )
            db.add(d)
            creadas.append(d)

        if usuario_id:
            await registrar_log(
                db, usuario_id=usuario_id, username=username,
                accion="DEVOLUCION_PARCIAL", recurso="Venta", recurso_id=str(item.movimiento_id),
                detalles={
                    "folio": folio,
                    "producto": m.producto_nombre,
                    "variante": m.variante,
                    "qty_original": orig_qty,
                    "qty_devuelto": item.qty_a_devolver,
                    "precio": float(m.precio),
                    "piezas_registradas": len(piezas_mov),
                }
            )
            
    await db.commit()
    for d in creadas:
        await db.refresh(d)
    return creadas


async def cancelar_venta_completa(
    db: AsyncSession,
    folio: str,
    usuario_id: Optional[int] = None,
    username: Optional[str] = None
):
    import re
    stmt = select(models.Movimiento).where(models.Movimiento.tipo == "venta")
    res = await db.execute(stmt)
    movs = res.scalars().all()
    
    target_movs = []
    for m in movs:
        mov_folio = str(m.id)
        if m.notas:
            parts = m.notas.split(' | ')
            potential_folio = parts[0].split(' ')[0]
            if re.match(r'^\d{8}-', potential_folio) or potential_folio.startswith('TICKET-'):
                mov_folio = potential_folio
        
        if mov_folio == folio:
            target_movs.append(m)
            
    if not target_movs:
        raise HTTPException(status_code=404, detail=f"No se encontraron movimientos para el folio {folio}")
        
    for m in target_movs:
        if m.producto_id:
            p = await db.get(models.Producto, m.producto_id)
            if p:
                p.qty += m.qty
                
        if usuario_id:
            await registrar_log(
                db, usuario_id=usuario_id, username=username,
                accion="CANCELAR_VENTA", recurso="Venta", recurso_id=str(m.id),
                detalles={
                    "folio": folio,
                    "producto": m.producto_nombre,
                    "variante": m.variante,
                    "qty": m.qty,
                    "precio": float(m.precio)
                }
            )
        await db.delete(m)

    # Piezas devueltas vendidas desde este folio: vuelven a estar disponibles
    await _restaurar_piezas_vendidas(db, folio)

    await db.commit()
    return True


# ── DEVOLUCIONES (PLAYERAS DEVUELTAS) ────────────────────────────────

ALLOWED_IMG_EXTS = {".jpg", ".jpeg", ".png", ".webp"}
MAX_IMG_BYTES = 8 * 1024 * 1024  # 8 MB


def _dev_img_dir() -> str:
    """backend/uploads/devoluciones — misma carpeta en host y contenedor (mount ./backend:/app)."""
    ruta = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "uploads", "devoluciones")
    os.makedirs(ruta, exist_ok=True)
    return ruta


def _detectar_ext_imagen(contenido: bytes) -> Optional[str]:
    if contenido[:3] == b"\xff\xd8\xff":
        return ".jpg"
    if contenido[:8] == b"\x89PNG\r\n\x1a\n":
        return ".png"
    if contenido[:4] == b"RIFF" and contenido[8:12] == b"WEBP":
        return ".webp"
    return None


def validar_imagen_devolucion(contenido: bytes, filename: str) -> str:
    """Valida extensión declarada + firma real del archivo. Regresa la extensión detectada."""
    ext_declarada = os.path.splitext(filename or "")[1].lower()
    if ext_declarada and ext_declarada not in ALLOWED_IMG_EXTS:
        raise HTTPException(status_code=400, detail="Formato no permitido. Usa una imagen JPG, PNG o WEBP.")
    if not contenido:
        raise HTTPException(status_code=400, detail="La imagen llegó vacía, intenta de nuevo.")
    if len(contenido) > MAX_IMG_BYTES:
        raise HTTPException(status_code=400, detail="La imagen supera el límite de 8 MB.")
    ext = _detectar_ext_imagen(contenido)
    if not ext:
        raise HTTPException(status_code=400, detail="El archivo no es una imagen válida (JPG, PNG o WEBP).")
    return ext


def ruta_imagen_devolucion(d: models.Devolucion) -> Optional[str]:
    if not d.imagen:
        return None
    ruta = os.path.join(_dev_img_dir(), os.path.basename(d.imagen))
    return ruta if os.path.isfile(ruta) else None


async def _guardar_archivo_imagen(d: models.Devolucion, contenido: bytes, filename: str) -> str:
    """Guarda la imagen con nombre único y elimina la anterior (reemplazo)."""
    ext = validar_imagen_devolucion(contenido, filename)
    directorio = _dev_img_dir()
    nuevo_nombre = f"dev_{d.id}_{uuid.uuid4().hex[:12]}{ext}"
    with open(os.path.join(directorio, nuevo_nombre), "wb") as fh:
        fh.write(contenido)
    anterior = d.imagen
    d.imagen = nuevo_nombre
    if anterior:
        ruta_anterior = os.path.join(directorio, os.path.basename(anterior))
        if os.path.isfile(ruta_anterior):
            try:
                os.remove(ruta_anterior)
            except OSError:
                pass
    return nuevo_nombre


def _parsear_variante_producto(nombre: str):
    """(color, talla) a partir del nombre 'Base>Color>Talla'."""
    partes = [x.strip() for x in (nombre or "").split(">")[1:] if x.strip()]
    if not partes:
        return "", ""
    if len(partes) == 1:
        return "", partes[0]
    return partes[0], partes[-1]


async def get_devolucion(db: AsyncSession, dev_id: int):
    d = await db.get(models.Devolucion, dev_id)
    if not d:
        raise HTTPException(status_code=404, detail="Pieza devuelta no encontrada")
    return d


async def get_devoluciones(
    db: AsyncSession,
    estado: Optional[str] = None,
    producto_id: Optional[int] = None,
    query: Optional[str] = None,
    skip: int = 0,
    limit: int = 500
):
    stmt = select(models.Devolucion).order_by(
        models.Devolucion.fecha_ingreso.desc(), models.Devolucion.id.desc()
    )
    if estado and estado != "todas":
        stmt = stmt.where(models.Devolucion.estado == estado)
    if producto_id:
        stmt = stmt.where(models.Devolucion.producto_id == producto_id)
    res = await db.execute(stmt)
    filas = res.scalars().all()
    if query:
        filas = [
            d for d in filas
            if _coincide_busqueda(
                [d.producto_nombre, d.diseno, d.folio_origen, d.notas, d.motivo, d.color, d.talla, d.variante],
                query,
            )
        ]
    return filas[skip: skip + limit]


async def get_devoluciones_resumen(db: AsyncSession):
    """Unidades disponibles por producto (para la columna «Devueltas» del inventario)."""
    res = await db.execute(
        select(models.Devolucion.producto_id, func.sum(models.Devolucion.qty))
        .where(models.Devolucion.estado == "disponible")
        .where(models.Devolucion.producto_id.isnot(None))
        .group_by(models.Devolucion.producto_id)
    )
    items = [{"producto_id": pid, "disponibles": int(total or 0)} for pid, total in res.all()]
    return {"items": items, "total": sum(i["disponibles"] for i in items)}


async def crear_devolucion_manual(
    db: AsyncSession,
    *,
    producto_id: int,
    qty: int,
    diseno: str,
    motivo: str = "",
    notas: str = "",
    precio: Optional[float] = None,
    ya_contada: bool = False,
    contenido_imagen: Optional[bytes] = None,
    filename_imagen: str = "",
    usuario_id: Optional[int] = None,
    username: Optional[str] = None,
):
    """Alta manual de una pieza devuelta (con foto obligatoria).

    ya_contada=False agrega la pieza al stock (movimiento de entrada);
    ya_contada=True solo la registra (el stock ya la incluía).
    """
    if qty < 1:
        raise HTTPException(status_code=400, detail="La cantidad debe ser al menos 1")
    diseno = (diseno or "").strip()
    if not diseno:
        raise HTTPException(status_code=400, detail="Describe el diseño de la pieza devuelta")
    if not contenido_imagen:
        raise HTTPException(status_code=400, detail="La foto del diseño es obligatoria")
    validar_imagen_devolucion(contenido_imagen, filename_imagen)

    p = await get_producto(db, producto_id)
    color, talla = _parsear_variante_producto(p.nombre)
    d = models.Devolucion(
        producto_id=p.id,
        producto_nombre=p.nombre,
        color=color,
        talla=talla,
        variante=">".join([x for x in (color, talla) if x]),
        diseno=diseno,
        qty=qty,
        precio=_centavos(precio if precio is not None else p.venta),
        motivo=(motivo or "").strip(),
        notas=(notas or "").strip(),
        estado="disponible",
    )
    db.add(d)
    await db.flush()  # id para el nombre del archivo
    await _guardar_archivo_imagen(d, contenido_imagen, filename_imagen)

    if not ya_contada:
        p.qty += qty
        db.add(models.Movimiento(
            tipo="entrada", producto_id=p.id, producto_nombre=p.nombre,
            variante=d.variante, qty=qty, precio=d.precio,
            canal="Devolución registrada", notas=f"Alta de pieza devuelta | Diseño: {diseno}",
        ))

    await db.commit()
    await db.refresh(d)
    if usuario_id:
        await registrar_log(
            db, usuario_id=usuario_id, username=username,
            accion="CREAR_DEVOLUCION", recurso="Devolucion", recurso_id=str(d.id),
            detalles={"producto": p.nombre, "qty": qty, "diseno": diseno, "ya_contada": ya_contada, "precio": float(d.precio)}
        )
    return d


async def actualizar_devolucion(
    db: AsyncSession,
    dev_id: int,
    data: schemas.DevolucionUpdateIn,
    usuario_id: Optional[int] = None,
    username: Optional[str] = None
):
    d = await get_devolucion(db, dev_id)
    if d.estado != "disponible":
        raise HTTPException(status_code=400, detail=f"Solo se editan piezas disponibles (esta pieza está {d.estado})")

    cambios = {}
    if data.diseno is not None:
        nuevo = data.diseno.strip()
        if not nuevo:
            raise HTTPException(status_code=400, detail="El diseño no puede quedar vacío")
        d.diseno = nuevo
        cambios["diseno"] = nuevo
    if data.motivo is not None:
        d.motivo = data.motivo.strip()
        cambios["motivo"] = d.motivo
    if data.notas is not None:
        d.notas = data.notas.strip()
        cambios["notas"] = d.notas
    if data.precio is not None:
        if data.precio < 0:
            raise HTTPException(status_code=400, detail="El precio no puede ser negativo")
        d.precio = _centavos(data.precio)
        cambios["precio"] = float(d.precio)
    if data.qty is not None and data.qty != d.qty:
        if data.qty < 1:
            raise HTTPException(status_code=400, detail="La cantidad debe ser al menos 1")
        delta = data.qty - d.qty
        if d.producto_id:
            p = await db.get(models.Producto, d.producto_id)
            if p:
                p.qty = max(0, p.qty + delta)
        cambios["qty"] = {"antes": d.qty, "ahora": data.qty}
        d.qty = data.qty

    await db.commit()
    await db.refresh(d)
    if usuario_id and cambios:
        await registrar_log(
            db, usuario_id=usuario_id, username=username,
            accion="EDITAR_DEVOLUCION", recurso="Devolucion", recurso_id=str(d.id),
            detalles=cambios
        )
    return d


async def guardar_imagen_devolucion(
    db: AsyncSession,
    dev_id: int,
    contenido: bytes,
    filename: str,
    usuario_id: Optional[int] = None,
    username: Optional[str] = None
):
    d = await get_devolucion(db, dev_id)
    await _guardar_archivo_imagen(d, contenido, filename)
    await db.commit()
    await db.refresh(d)
    if usuario_id:
        await registrar_log(
            db, usuario_id=usuario_id, username=username,
            accion="SUBIR_FOTO_DEVOLUCION", recurso="Devolucion", recurso_id=str(d.id),
            detalles={"imagen": d.imagen}
        )
    return d


async def vender_devolucion(
    db: AsyncSession,
    dev_id: int,
    data: Optional[schemas.DevolucionVenderIn] = None,
    usuario_id: Optional[int] = None,
    username: Optional[str] = None
):
    d = await get_devolucion(db, dev_id)
    if d.estado != "disponible":
        raise HTTPException(status_code=400, detail=f"Esta pieza ya no está disponible (estado: {d.estado})")

    p = await db.get(models.Producto, d.producto_id) if d.producto_id else None
    if not p:
        raise HTTPException(status_code=400, detail="El producto de esta pieza ya no existe en el inventario")
    if p.qty < d.qty:
        raise HTTPException(status_code=400, detail=f"Stock insuficiente para vender la pieza (disponible: {p.qty})")

    data = data or schemas.DevolucionVenderIn()
    notas_extra = (data.notas or "").strip()
    p.qty -= d.qty
    ahora = datetime.now(MX_TZ)
    folio = f"{ahora.strftime('%Y%m%d')}-DEV{d.id}-{ahora.strftime('%H%M%S')}"
    db.add(models.Movimiento(
        tipo="venta", producto_id=p.id, producto_nombre=d.producto_nombre or p.nombre,
        variante=d.variante, qty=d.qty, precio=d.precio,
        canal=(data.canal or "Devolución"),
        notas=f"{folio} | Pieza devuelta | Diseño: {d.diseno}" + (f" | {notas_extra}" if notas_extra else ""),
    ))
    d.estado = "vendida"
    d.fecha_salida = ahora
    d.folio_origen = folio
    if notas_extra:
        d.notas = f"{d.notas} | {notas_extra}".strip(" |")

    if p.qty <= p.min_stock:
        await crear_notificacion(db, f"Stock bajo en {p.nombre}: {p.qty} unidades", "stock_bajo", p.id)

    await db.commit()
    await db.refresh(d)
    if usuario_id:
        await registrar_log(
            db, usuario_id=usuario_id, username=username,
            accion="VENDER_DEVOLUCION", recurso="Devolucion", recurso_id=str(d.id),
            detalles={"producto": d.producto_nombre, "qty": d.qty, "precio": float(d.precio), "folio": folio, "diseno": d.diseno}
        )
    return d, folio


async def descartar_devolucion(
    db: AsyncSession,
    dev_id: int,
    data: Optional[schemas.DevolucionDescartarIn] = None,
    usuario_id: Optional[int] = None,
    username: Optional[str] = None
):
    d = await get_devolucion(db, dev_id)
    if d.estado != "disponible":
        raise HTTPException(status_code=400, detail=f"Esta pieza ya no está disponible (estado: {d.estado})")

    motivo = (data.motivo or "").strip() if data else ""
    p = await db.get(models.Producto, d.producto_id) if d.producto_id else None
    if p:
        p.qty = max(0, p.qty - d.qty)
    db.add(models.Movimiento(
        tipo="ajuste", producto_id=d.producto_id, producto_nombre=d.producto_nombre,
        variante=d.variante, qty=d.qty, precio=d.precio, canal="Devolución descartada",
        notas=f"Descarte de pieza devuelta | Diseño: {d.diseno}" + (f" | {motivo}" if motivo else ""),
    ))
    d.estado = "descartada"
    d.fecha_salida = datetime.now(MX_TZ)
    if motivo:
        d.motivo = motivo

    await db.commit()
    await db.refresh(d)
    if usuario_id:
        await registrar_log(
            db, usuario_id=usuario_id, username=username,
            accion="DESCARTAR_DEVOLUCION", recurso="Devolucion", recurso_id=str(d.id),
            detalles={"producto": d.producto_nombre, "qty": d.qty, "diseno": d.diseno, "motivo": motivo}
        )
    return d


async def _restaurar_piezas_vendidas(db: AsyncSession, folio: str):
    """Si se cancela/revierte la venta de una pieza devuelta, vuelve a 'disponible'."""
    res = await db.execute(
        select(models.Devolucion)
        .where(models.Devolucion.folio_origen == folio)
        .where(models.Devolucion.estado == "vendida")
    )
    for d in res.scalars().all():
        d.estado = "disponible"
        d.fecha_salida = None


# ── ALERTAS INTELIGENTES ─────────────────────────────────────────────

async def get_alertas_inteligentes(db: AsyncSession):
    """
    Analiza el inventario y retorna los productos agrupados inteligentemente:
    - stock_bajo_prioritario: Tienen stock bajo y han tenido movimientos (ventas/entradas)
    - sin_stock_prioritario: Están agotados y han tenido movimientos
    - sin_movimiento: Nunca han tenido entradas ni ventas
    """
    productos_res = await db.execute(select(models.Producto))
    productos = productos_res.scalars().all()
    
    movimientos_res = await db.execute(
        select(models.Movimiento).where(models.Movimiento.tipo.in_(["venta", "entrada"]))
    )
    movimientos = movimientos_res.scalars().all()
    
    con_movimiento = set()
    ventas_por_producto = {}
    ingresos_por_producto = {}
    
    for mov in movimientos:
        if mov.producto_id:
            con_movimiento.add(mov.producto_id)
            if mov.tipo == "venta":
                ventas_por_producto[mov.producto_id] = ventas_por_producto.get(mov.producto_id, 0) + mov.qty
                ingresos_por_producto[mov.producto_id] = ingresos_por_producto.get(mov.producto_id, Decimal("0")) + (mov.qty * mov.precio)
                
    stock_bajo = []
    sin_stock = []
    sin_actividad = []
    
    for p in productos:
        tiene_movimiento = p.id in con_movimiento
        
        p_data = {
            "id": p.id,
            "nombre": p.nombre,
            "sku": p.sku or "",
            "categoria": p.categoria or "Otro",
            "qty": p.qty,
            "min_stock": p.min_stock,
            "costo": p.costo,
            "venta": p.venta,
            "ventas_historicas": ventas_por_producto.get(p.id, 0),
            "total_ingresos": ingresos_por_producto.get(p.id, 0.0)
        }
        
        if not tiene_movimiento:
            sin_actividad.append(p_data)
        else:
            if p.qty <= 0:
                sin_stock.append(p_data)
            elif p.qty <= p.min_stock:
                stock_bajo.append(p_data)
                
    # Ordenar por ventas históricas (prioridad)
    stock_bajo.sort(key=lambda x: x["ventas_historicas"], reverse=True)
    sin_stock.sort(key=lambda x: x["ventas_historicas"], reverse=True)
    # Sin actividad ordenar alfabéticamente
    sin_actividad.sort(key=lambda x: x["nombre"])
    
    return {
        "stock_bajo_prioritario": stock_bajo,
        "sin_stock_prioritario": sin_stock,
        "sin_movimiento": sin_actividad
    }


# ── ÓRDENES DE COMPRA / CONTABILIDAD ─────────────────────────────────

def cuotas_msi(total, meses: int) -> List[Decimal]:
    """Reparte un total en cuotas de 2 decimales cuya suma es exactamente el total.

    La última cuota absorbe la diferencia del redondeo (cuotas iguales + ajuste final),
    de modo que MSI nunca pierde ni gana centavos (ej. 100.00/3 → 33.33, 33.33, 33.34).
    """
    total = _centavos(total)
    base = _centavos(total / meses)
    return [base] * (meses - 1) + [total - base * (meses - 1)]


async def registrar_egreso_orden(db: AsyncSession, orden, ahora: Optional[datetime] = None):
    """Agrega a la sesión el/los egresos contables de una OC confirmada (pago único o N cuotas MSI)."""
    ahora = ahora or datetime.now()
    if getattr(orden, "pago_msi", 0) == 1 and getattr(orden, "meses_msi", 1) > 1:
        montos = cuotas_msi(orden.total_estimado, orden.meses_msi)
    else:
        montos = [_centavos(orden.total_estimado)]

    for i, monto in enumerate(montos):
        detalle = f" (Mes {i+1}/{len(montos)})" if len(montos) > 1 else ""
        db.add(models.ContabilidadTransaccion(
            tipo="egreso",
            monto=monto,
            fecha=ahora + relativedelta(months=i),
            procedencia_destino=orden.proveedor or "Desconocido",
            concepto=f"Pago OC {orden.folio}{detalle} - {orden.tipo_compra}",
            referencia_id=orden.id,
        ))
