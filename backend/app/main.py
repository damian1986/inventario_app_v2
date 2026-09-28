from contextlib import asynccontextmanager
from fastapi import FastAPI, Depends, HTTPException, Query, status, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import Limiter
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
import os
import ipaddress


async def _rate_limit_handler(request: Request, exc: RateLimitExceeded):
    return JSONResponse(status_code=429, content={"error": exc.detail})


def _client_ip(request: Request) -> str:
    """IP real del cliente. Solo confía en X-Forwarded-For si el par es un proxy de red interna."""
    peer = request.client.host if request.client else ""
    try:
        via_proxy = ipaddress.ip_address(peer).is_private
    except ValueError:
        via_proxy = False
    if via_proxy:
        fwd = request.headers.get("x-forwarded-for")
        if fwd:
            return fwd.split(",")[0].strip()
    return peer or get_remote_address(request)


RATE_LIMIT_ENABLED = os.getenv("RATE_LIMIT_DISABLED", "").lower() not in ("1", "true", "yes")
limiter = Limiter(key_func=_client_ip, storage_uri="memory://", enabled=RATE_LIMIT_ENABLED)

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from typing import List, Optional
from datetime import datetime
from zoneinfo import ZoneInfo

MX_TZ = ZoneInfo("America/Mexico_City")
from app.database import get_db, engine, SessionLocal
from app import models, schemas, services
from app.sku import generar_sku
from app.auth import create_access_token, require_role, get_current_user
import random


from sqlalchemy import text


@asynccontextmanager
async def lifespan(app: FastAPI):
    import asyncio as _aio

    async with engine.begin() as conn:
        await conn.run_sync(models.Base.metadata.create_all)
        # Migración simple para columnas añadidas
        try:
            await conn.execute(text("ALTER TABLE productos ADD COLUMN IF NOT EXISTS notas_internas TEXT DEFAULT ''"))
            await conn.execute(text("ALTER TABLE productos ADD COLUMN IF NOT EXISTS proveedores_alternativos VARCHAR(500) DEFAULT ''"))
            await conn.execute(text("ALTER TABLE productos ADD COLUMN IF NOT EXISTS costo_menudeo FLOAT DEFAULT 0.0"))
            await conn.execute(text("ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS email VARCHAR(200) DEFAULT ''"))
            await conn.execute(text("ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS nombre VARCHAR(200) DEFAULT ''"))
            await conn.execute(text("ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS totp_secret VARCHAR(32) DEFAULT NULL"))
            await conn.execute(text("ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS totp_enabled INTEGER DEFAULT 0"))
            # Conversión de columnas de dinero FLOAT → NUMERIC(12,2) (idempotente)
            await conn.execute(text("""
                DO $$
                DECLARE col record;
                BEGIN
                    FOR col IN
                        SELECT * FROM (VALUES
                            ('productos','costo'), ('productos','venta'), ('productos','costo_menudeo'),
                            ('movimientos','precio'),
                            ('descuentos','valor'),
                            ('ordenes_compra','total_estimado'),
                            ('ordenes_compra_items','precio_proveedor'), ('ordenes_compra_items','subtotal'),
                            ('historial_precios','costo_anterior'), ('historial_precios','costo_nuevo'),
                            ('historial_precios','venta_anterior'), ('historial_precios','venta_nuevo'),
                            ('contabilidad_transacciones','monto')
                        ) AS t(tabla, columna)
                    LOOP
                        IF EXISTS (
                            SELECT 1 FROM information_schema.columns
                            WHERE table_schema = current_schema()
                              AND table_name = col.tabla
                              AND column_name = col.columna
                              AND data_type = 'double precision'
                        ) THEN
                            EXECUTE format('ALTER TABLE %I ALTER COLUMN %I TYPE numeric(12,2) USING %I::numeric(12,2)',
                                           col.tabla, col.columna, col.columna);
                        END IF;
                    END LOOP;
                END $$;
            """))
        except Exception as e:
            print(f"Migración: {e}")

    # Crear admin por defecto si la tabla de usuarios está vacía
    async with SessionLocal() as db:
        await services.seed_admin_if_empty(db)

    # ── Programar backup automático cada 24h ──
    async def _backup_scheduler():
        INTERVAL_HOURS = 24
        # Esperar un poco al arranque para no sobrecargar
        await _aio.sleep(30)
        print(f"[BACKUP SCHEDULER] Iniciado. Frecuencia: {INTERVAL_HOURS}h")
        
        while True:
            try:
                now = datetime.now(MX_TZ).strftime("%Y-%m-%d %H:%M:%S")
                print(f"[BACKUP SCHEDULER] Iniciando respaldo programado a las {now}...")
                filepath = await services.crear_backup_db()
                if filepath:
                    print(f"[BACKUP SCHEDULER] ✅ Respaldo completado: {os.path.basename(filepath)}")
                else:
                    print("[BACKUP SCHEDULER] ❌ Falló la creación del respaldo programado. Ver logs de pg_dump.")
            except Exception as e:
                print(f"[BACKUP SCHEDULER ERROR] {e}")
            
            # Esperar 24 horas para la siguiente ejecución
            await _aio.sleep(INTERVAL_HOURS * 3600)

    backup_task = _aio.create_task(_backup_scheduler())

    yield

    # Cleanup: cancelar el task de backup al apagar
    backup_task.cancel()


app = FastAPI(title="Inventario API", version="2.0.0", lifespan=lifespan)

# Rate limiting en endpoints de credenciales (desactivable con RATE_LIMIT_DISABLED=1)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_handler)

@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    return response

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── PRODUCTOS ─────────────────────────────────────────────────────────
@app.get("/productos", response_model=List[schemas.ProductoOut],
         dependencies=[Depends(require_role("admin", "vendedor", "bodeguero"))])
async def listar_productos(
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=1000, ge=1, le=5000),
    db: AsyncSession = Depends(get_db)
):
    return await services.get_productos(db, skip=skip, limit=limit)


@app.post("/productos", response_model=schemas.ProductoOut, status_code=201,
          dependencies=[Depends(require_role("admin"))])
async def crear_producto(
    data: schemas.ProductoCreate, 
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(get_current_user)
):
    res = await services.crear_producto(db, data)
    await services.registrar_log(
        db, usuario_id=current_user.id, username=current_user.username,
        accion="CREAR_PRODUCTO", recurso="Producto", recurso_id=str(res.id),
        detalles={"nombre": res.nombre, "sku": res.sku, "qty": res.qty}
    )
    return res


@app.get("/productos/{id}", response_model=schemas.ProductoOut,
         dependencies=[Depends(require_role("admin", "vendedor", "bodeguero"))])
async def obtener_producto(id: int, db: AsyncSession = Depends(get_db)):
    return await services.get_producto(db, id)


@app.get("/productos/{id}/historial-precios", response_model=List[schemas.HistorialPrecioOut],
         dependencies=[Depends(require_role("admin", "bodeguero"))])
async def obtener_historial_precios(id: int, db: AsyncSession = Depends(get_db)):
    return await services.get_historial_precios(db, id)


@app.put("/productos/{id}", response_model=schemas.ProductoOut,
         dependencies=[Depends(require_role("admin"))])
async def actualizar_producto(
    id: int, 
    data: schemas.ProductoUpdate, 
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(get_current_user)
):
    res = await services.actualizar_producto(db, id, data)
    await services.registrar_log(
        db, usuario_id=current_user.id, username=current_user.username,
        accion="EDITAR_PRODUCTO", recurso="Producto", recurso_id=str(res.id),
        detalles={"nombre": res.nombre, "sku": res.sku}
    )
    return res


@app.delete("/productos/{id}", status_code=204,
            dependencies=[Depends(require_role("admin"))])
async def eliminar_producto(
    id: int, 
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(get_current_user)
):
    # Obtener nombre antes de eliminar para el log
    p = await services.get_producto(db, id)
    nombre = p.nombre
    await services.eliminar_producto(db, id)
    await services.registrar_log(
        db, usuario_id=current_user.id, username=current_user.username,
        accion="ELIMINAR_PRODUCTO", recurso="Producto", recurso_id=str(id),
        detalles={"nombre": nombre}
    )


@app.patch("/productos/{id}/qty",
           dependencies=[Depends(require_role("admin", "bodeguero"))])
async def cambiar_qty(
    id: int, 
    delta: int, 
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(get_current_user)
):
    res = await services.cambiar_qty(db, id, delta)
    await services.registrar_log(
        db, usuario_id=current_user.id, username=current_user.username,
        accion="CAMBIAR_QTY", recurso="Producto", recurso_id=str(res.id),
        detalles={"nombre": res.nombre, "delta": delta, "nueva_qty": res.qty}
    )
    return res


# ── VENTAS ────────────────────────────────────────────────────────────
@app.post("/ventas", response_model=schemas.MovimientoOut, status_code=201,
          dependencies=[Depends(require_role("admin", "vendedor"))])
async def registrar_venta(
    data: schemas.VentaRequest, 
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(get_current_user)
):
    res = await services.registrar_venta(db, data)
    await services.registrar_log(
        db, usuario_id=current_user.id, username=current_user.username,
        accion="REGISTRAR_VENTA", recurso="Venta", recurso_id=str(res.id),
        detalles={"producto": res.producto_nombre, "qty": res.qty, "total": float(res.qty * res.precio)}
    )
    return res


@app.get("/ventas-agrupadas", response_model=List[schemas.VentaAgrupadaOut],
         dependencies=[Depends(require_role("admin", "vendedor"))])
async def obtener_ventas_agrupadas(
    desde: Optional[str] = Query(None),
    hasta: Optional[str] = Query(None),
    canal: Optional[str] = Query(None),
    query: Optional[str] = Query(None),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=500),
    db: AsyncSession = Depends(get_db)
):
    return await services.get_ventas_agrupadas(
        db, desde=desde, hasta=hasta, canal=canal, query=query, skip=skip, limit=limit
    )


@app.post("/ventas/devolver",
          dependencies=[Depends(require_role("admin"))])
async def devolver_venta_parcial(
    data: schemas.DevolucionParcialRequest,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(get_current_user)
):
    await services.procesar_devolucion_parcial(
        db, folio=data.folio, items=data.items, 
        usuario_id=current_user.id, username=current_user.username
    )
    return {"status": "ok", "mensaje": "Devolución procesada correctamente e inventario actualizado"}


@app.post("/ventas/cancelar-completo/{folio}",
          dependencies=[Depends(require_role("admin"))])
async def cancelar_venta_completa(
    folio: str,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(get_current_user)
):
    await services.cancelar_venta_completa(
        db, folio=folio, usuario_id=current_user.id, username=current_user.username
    )
    return {"status": "ok", "mensaje": f"Venta con folio {folio} cancelada completamente"}


# ── AJUSTES ──────────────────────────────────────────────────────────
@app.post("/productos/{id}/ajuste", response_model=schemas.MovimientoOut,
          dependencies=[Depends(require_role("admin", "bodeguero"))])
async def ajustar_inventario(
    id: int, 
    data: schemas.AjusteRequest, 
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(get_current_user)
):
    res = await services.ajustar_inventario(db, id, data)
    await services.registrar_log(
        db, usuario_id=current_user.id, username=current_user.username,
        accion="AJUSTAR_INVENTARIO", recurso="Producto", recurso_id=str(id),
        detalles={"producto": res.producto_nombre, "nueva_qty": data.nueva_qty, "motivo": data.motivo}
    )
    return res


# ── HISTORIAL ────────────────────────────────────────────────────────
@app.get("/movimientos", response_model=List[schemas.MovimientoOut],
         dependencies=[Depends(require_role("admin", "vendedor", "bodeguero"))])
async def listar_movimientos(
    tipo: Optional[str] = None,
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=500, ge=1, le=2000),
    db: AsyncSession = Depends(get_db)
):
    return await services.get_movimientos(db, tipo=tipo, skip=skip, limit=limit)


@app.delete("/movimientos/{id}", status_code=204,
            dependencies=[Depends(require_role("admin"))])
async def eliminar_movimiento(id: int, db: AsyncSession = Depends(get_db)):
    return await services.eliminar_movimiento(db, id)


@app.put("/movimientos/{id}", response_model=schemas.MovimientoOut,
         dependencies=[Depends(require_role("admin"))])
async def actualizar_movimiento(id: int, data: schemas.MovimientoUpdate, db: AsyncSession = Depends(get_db)):
    return await services.actualizar_movimiento(db, id, data)


# ── REPORTE ──────────────────────────────────────────────────────────
@app.get("/reporte", dependencies=[Depends(require_role("admin"))])
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


# ── DESCUENTOS ───────────────────────────────────────────────────────

@app.get("/descuentos", response_model=List[schemas.DescuentoOut],
         dependencies=[Depends(require_role("admin", "vendedor"))])
async def listar_descuentos(
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=500),
    db: AsyncSession = Depends(get_db)
):
    return await services.get_descuentos(db, skip=skip, limit=limit)


@app.post("/descuentos", response_model=schemas.DescuentoOut, status_code=201,
          dependencies=[Depends(require_role("admin"))])
async def crear_descuento(
    data: schemas.DescuentoCreate,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(get_current_user)
):
    res = await services.crear_descuento(db, data)
    await services.registrar_log(
        db, usuario_id=current_user.id, username=current_user.username,
        accion="CREAR_DESCUENTO", recurso="Descuento", recurso_id=str(res.id),
        detalles={"codigo": res.codigo, "tipo": res.tipo, "valor": float(res.valor)}
    )
    return res


@app.put("/descuentos/{id}", response_model=schemas.DescuentoOut,
         dependencies=[Depends(require_role("admin"))])
async def actualizar_descuento(
    id: int,
    data: schemas.DescuentoUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(get_current_user)
):
    res = await services.actualizar_descuento(db, id, data)
    await services.registrar_log(
        db, usuario_id=current_user.id, username=current_user.username,
        accion="EDITAR_DESCUENTO", recurso="Descuento", recurso_id=str(res.id),
        detalles={"codigo": res.codigo}
    )
    return res


@app.delete("/descuentos/{id}", status_code=204,
            dependencies=[Depends(require_role("admin"))])
async def eliminar_descuento(
    id: int,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(get_current_user)
):
    # Obtener codigo antes de borrar
    stmt = select(models.Descuento).where(models.Descuento.id == id)
    res_d = await db.execute(stmt)
    d = res_d.scalar_one_or_none()
    codigo = d.codigo if d else "Desconocido"
    
    await services.eliminar_descuento(db, id)
    await services.registrar_log(
        db, usuario_id=current_user.id, username=current_user.username,
        accion="ELIMINAR_DESCUENTO", recurso="Descuento", recurso_id=str(id),
        detalles={"codigo": codigo}
    )


@app.get("/descuentos/validar/{codigo}", response_model=schemas.DescuentoValidarResponse,
         dependencies=[Depends(require_role("admin", "vendedor"))])
async def validar_descuento(
    codigo: str,
    total_items: int = Query(..., ge=1),
    db: AsyncSession = Depends(get_db)
):
    return await services.validar_descuento(db, codigo, total_items)


# ── UTILIDADES ──────────────────────────────────────────────────────
@app.get("/sku/preview", dependencies=[Depends(require_role("admin"))])
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


# ── AUTENTICACIÓN ────────────────────────────────────────────────────

@app.post("/auth/login", response_model=schemas.TokenResponse)
@limiter.limit("10/minute;100/hour", error_message="Demasiados intentos de inicio de sesión. Espera un momento e inténtalo de nuevo.")
async def login(request: Request, data: schemas.LoginRequest, db: AsyncSession = Depends(get_db)):
    """Valida credenciales y retorna un JWT de acceso o solicita 2FA."""
    user = await services.autenticar_usuario(db, data.username, data.password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Usuario o contraseña incorrectos",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    # Si tiene 2FA activado, no entregar el token final aún
    if user.totp_enabled:
        from datetime import timedelta
        # Token temporal de corta duración (5 min) con claim especial
        temp_token = create_access_token({"sub": user.username, "2fa_pending": True}, expires_delta=timedelta(minutes=5))
        return schemas.TokenResponse(
            requires_2fa=True,
            temp_token=temp_token,
            username=user.username
        )

    # Login normal
    token = create_access_token({"sub": user.username, "rol": user.rol})
    await services.registrar_log(
        db, usuario_id=user.id, username=user.username,
        accion="LOGIN", recurso="Sistema", recurso_id=str(user.id),
        detalles={"rol": user.rol}
    )
    
    return schemas.TokenResponse(
        access_token=token,
        token_type="bearer",
        rol=user.rol,
        username=user.username,
        nombre=user.nombre,
        id=user.id,
    )


@app.post("/auth/2fa/setup", response_model=schemas.TOTPSetupResponse)
async def setup_2fa(db: AsyncSession = Depends(get_db), current_user: models.Usuario = Depends(get_current_user)):
    """Inicia la configuración de 2FA generando un secreto y QR URI."""
    return await services.preparar_setup_totp(db, current_user.id)


@app.post("/auth/2fa/enable")
async def enable_2fa(data: schemas.TOTPVerifyRequest, db: AsyncSession = Depends(get_db), current_user: models.Usuario = Depends(get_current_user)):
    """Valida el primer código y activa 2FA definitivamente."""
    success = await services.activar_totp(db, current_user.id, data.code)
    if not success:
        raise HTTPException(status_code=400, detail="Código de verificación 2FA no válido")
    return {"status": "ok", "message": "2FA habilitado correctamente"}


@app.post("/auth/2fa/verify", response_model=schemas.TokenResponse)
@limiter.limit("10/minute;100/hour", error_message="Demasiados intentos de verificación 2FA. Espera un momento e inténtalo de nuevo.")
async def verify_2fa(request: Request, data: schemas.TOTPVerifyRequest, db: AsyncSession = Depends(get_db)):
    """Segundo paso del login: verifica el código TOTP y entrega el JWT final."""
    from app.auth import decode_token
    if not data.temp_token:
        raise HTTPException(status_code=401, detail="Se requiere token temporal")
        
    payload = decode_token(data.temp_token)
    if not payload.get("2fa_pending"):
        raise HTTPException(status_code=401, detail="Token no válido para 2FA")
    
    username = payload.get("sub")
    success = await services.verificar_login_totp(db, username, data.code)
    if not success:
        raise HTTPException(status_code=401, detail="Código 2FA incorrecto")
        
    # Obtener el usuario completo
    q = await db.execute(select(models.Usuario).where(models.Usuario.username == username))
    user = q.scalar_one_or_none()
    
    token = create_access_token({"sub": user.username, "rol": user.rol})
    await services.registrar_log(
        db, usuario_id=user.id, username=user.username,
        accion="LOGIN_2FA", recurso="Sistema", recurso_id=str(user.id),
        detalles={"rol": user.rol}
    )
    
    return schemas.TokenResponse(
        access_token=token,
        token_type="bearer",
        rol=user.rol,
        username=user.username,
        nombre=user.nombre,
        id=user.id,
    )


@app.get("/auth/me", response_model=schemas.UsuarioOut)
async def get_me(current_user: models.Usuario = Depends(get_current_user)):
    """Retorna el perfil del usuario actual basado en el token."""
    return current_user


@app.get("/admin/usuarios", response_model=List[schemas.UsuarioOut],
         dependencies=[Depends(require_role("admin"))])
async def listar_usuarios(db: AsyncSession = Depends(get_db)):
    """Lista todos los usuarios registrados (solo admin)."""
    return await services.listar_usuarios(db)


@app.post("/admin/usuarios", response_model=schemas.UsuarioOut, status_code=201,
          dependencies=[Depends(require_role("admin"))])
async def crear_usuario(
    data: schemas.UsuarioCreate, 
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(get_current_user)
):
    """Crea un nuevo usuario (solo admin)."""
    res = await services.crear_usuario(db, data)
    await services.registrar_log(
        db, usuario_id=current_user.id, username=current_user.username,
        accion="CREAR_USUARIO", recurso="Usuario", recurso_id=str(res.id),
        detalles={"nuevo_usuario": res.username, "rol": res.rol}
    )
    return res


@app.put("/admin/usuarios/{id}", response_model=schemas.UsuarioOut,
         dependencies=[Depends(require_role("admin"))])
async def actualizar_usuario(
    id: int, 
    data: schemas.UsuarioUpdate, 
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(get_current_user)
):
    """Actualiza un usuario (solo admin)."""
    # Evitar desactivar al propio admin actual
    if id == current_user.id and data.activo == 0:
        raise HTTPException(status_code=400, detail="No puedes desactivar tu propia cuenta")
    
    res = await services.actualizar_usuario(db, id, data)
    await services.registrar_log(
        db, usuario_id=current_user.id, username=current_user.username,
        accion="EDITAR_USUARIO", recurso="Usuario", recurso_id=str(res.id),
        detalles={"usuario_afectado": res.username, "cambios": data.model_dump(exclude_unset=True, exclude={"password"})}
    )
    if data.password:
        # Log por separado para el cambio de password por seguridad
        await services.registrar_log(
            db, usuario_id=current_user.id, username=current_user.username,
            accion="CAMBIO_PASSWORD_AJENO", recurso="Usuario", recurso_id=str(res.id),
            detalles={"usuario_afectado": res.username}
        )
    return res


@app.delete("/admin/usuarios/{id}", status_code=204,
            dependencies=[Depends(require_role("admin"))])
async def eliminar_usuario(
    id: int, 
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(get_current_user)
):
    """Elimina permanentemente un usuario (solo admin)."""
    if id == current_user.id:
        raise HTTPException(status_code=400, detail="No puedes eliminar tu propia cuenta")
    
    # Obtener nombre antes de borrar
    users = await services.listar_usuarios(db)
    u_target = next((u for u in users if u.id == id), None)
    username = u_target.username if u_target else "Desconocido"

    await services.eliminar_usuario(db, id)
    await services.registrar_log(
        db, usuario_id=current_user.id, username=current_user.username,
        accion="ELIMINAR_USUARIO", recurso="Usuario", recurso_id=str(id),
        detalles={"usuario_eliminado": username}
    )


from fastapi.responses import FileResponse
import asyncio


# ── AUDITORÍA ────────────────────────────────────────────────────────

@app.get("/audit-logs", response_model=List[schemas.AuditLogOut],
         dependencies=[Depends(require_role("admin"))])
async def listar_audit_logs(
    usuario_id: Optional[int] = Query(None),
    accion: Optional[str] = Query(None),
    desde: Optional[str] = Query(None),
    hasta: Optional[str] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(200, ge=1, le=1000),
    db: AsyncSession = Depends(get_db)
):
    """Lista los logs de auditoría con filtros (solo admin)."""
    return await services.get_audit_logs(
        db, usuario_id=usuario_id, accion=accion, desde=desde, hasta=hasta, skip=skip, limit=limit
    )


@app.get("/audit-logs/stats", response_model=schemas.AuditStatsOut,
         dependencies=[Depends(require_role("admin"))])
async def audit_stats(db: AsyncSession = Depends(get_db)):
    """Retorna estadísticas rápidas del audit log (solo admin)."""
    return await services.get_audit_stats(db)


# ── RESPALDOS ────────────────────────────────────────────────────────

@app.post("/admin/backup", dependencies=[Depends(require_role("admin"))])
async def crear_backup(current_user: models.Usuario = Depends(get_current_user),
                       db: AsyncSession = Depends(get_db)):
    """Crea un respaldo manual de la base de datos (solo admin)."""
    filepath = await services.crear_backup_db()
    if not filepath:
        raise HTTPException(status_code=500, detail="Error al crear el respaldo. Revisa los logs del servidor.")
    
    await services.registrar_log(
        db, usuario_id=current_user.id, username=current_user.username,
        accion="CREAR_BACKUP", recurso="Sistema", recurso_id="backup",
        detalles={"archivo": os.path.basename(filepath)}
    )
    
    return {"status": "ok", "archivo": os.path.basename(filepath), "mensaje": "Respaldo creado exitosamente"}


@app.get("/admin/backups", response_model=List[schemas.BackupInfoOut],
         dependencies=[Depends(require_role("admin"))])
async def listar_backups():
    """Lista los respaldos disponibles (solo admin)."""
    return services.listar_backups()


@app.get("/admin/backups/{nombre}")
async def descargar_backup(nombre: str, _=Depends(require_role("admin"))):
    """Descarga un archivo de respaldo específico (solo admin)."""
    from app.services import BACKUP_DIR
    filepath = os.path.join(BACKUP_DIR, nombre)
    if not os.path.isfile(filepath):
        raise HTTPException(status_code=404, detail="Archivo de respaldo no encontrado")
    return FileResponse(filepath, filename=nombre, media_type="application/sql")


@app.post("/admin/restore/{nombre}", dependencies=[Depends(require_role("admin"))])
async def restaurar_backup(nombre: str,
                          current_user: models.Usuario = Depends(get_current_user),
                          db: AsyncSession = Depends(get_db)):
    """Restaura la base de datos desde un respaldo específico (solo admin).
    Se crea un backup de seguridad automático antes de restaurar."""
    from app.services import BACKUP_DIR
    filepath = os.path.join(BACKUP_DIR, nombre)
    if not os.path.isfile(filepath):
        raise HTTPException(status_code=404, detail="Archivo de respaldo no encontrado")
    
    # Registrar la acción ANTES de restaurar (pues después se pierde la sesión)
    await services.registrar_log(
        db, usuario_id=current_user.id, username=current_user.username,
        accion="RESTAURAR_BACKUP", recurso="Sistema", recurso_id="backup",
        detalles={"archivo": nombre}
    )
    
    ok = await services.restaurar_backup_db(nombre)
    if not ok:
        raise HTTPException(status_code=500, detail="Error al restaurar la base de datos. Revisa los logs del servidor.")
    
    return {"status": "ok", "mensaje": f"Base de datos restaurada desde {nombre}. Recarga la página."}


@app.delete("/admin/backups/{nombre}", status_code=204,
            dependencies=[Depends(require_role("admin"))])
async def eliminar_backup(
    nombre: str,
    current_user: models.Usuario = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Elimina un archivo de respaldo específico (solo admin)."""
    from app.services import BACKUP_DIR
    # Prevenir path traversal
    if ".." in nombre or "/" in nombre or "\\" in nombre:
        raise HTTPException(status_code=400, detail="Nombre de archivo inválido")
    filepath = os.path.join(BACKUP_DIR, nombre)
    if not os.path.isfile(filepath):
        raise HTTPException(status_code=404, detail="Archivo de respaldo no encontrado")
    
    os.remove(filepath)
    
    await services.registrar_log(
        db, usuario_id=current_user.id, username=current_user.username,
        accion="ELIMINAR_BACKUP", recurso="Sistema", recurso_id="backup",
        detalles={"archivo": nombre}
    )


# ── NOTIFICACIONES ───────────────────────────────────────────────────

@app.get("/notificaciones", response_model=List[schemas.NotificacionOut],
         dependencies=[Depends(require_role("admin", "vendedor", "bodeguero"))])
async def listar_notificaciones(db: AsyncSession = Depends(get_db)):
    return await services.get_notificaciones(db)


@app.put("/notificaciones/{id}/leer", response_model=schemas.NotificacionOut,
         dependencies=[Depends(require_role("admin", "vendedor", "bodeguero"))])
async def leer_notificacion(id: int, db: AsyncSession = Depends(get_db)):
    return await services.marcar_notificacion_leida(db, id)


@app.delete("/notificaciones", status_code=204,
            dependencies=[Depends(require_role("admin", "vendedor", "bodeguero"))])
async def limpiar_notificaciones(db: AsyncSession = Depends(get_db)):
    return await services.limpiar_notificaciones(db)


# ── DASHBOARD INTELIGENCIA ───────────────────────────────────────────

@app.get("/dashboard/alertas-inteligentes", response_model=schemas.AlertasInteligentesOut,
         dependencies=[Depends(require_role("admin", "vendedor", "bodeguero"))])
async def alertas_inteligentes(db: AsyncSession = Depends(get_db)):
    return await services.get_alertas_inteligentes(db)


# ── ÓRDENES DE COMPRA ────────────────────────────────────────────────


def _generar_folio() -> str:
    now = datetime.now(MX_TZ)
    num = random.randint(1000, 9999)
    return f"OC-{now.year}-{num:04d}"


def _item_to_dict(it) -> dict:
    return {
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


def _orden_to_dict(orden, items) -> dict:
    return {
        "id": orden.id,
        "folio": orden.folio,
        "proveedor": orden.proveedor or "",
        "estado": orden.estado,
        "total_estimado": orden.total_estimado or 0.0,
        "notas": orden.notas or "",
        "tipo_compra": orden.tipo_compra or "ropa",
        "canal_compra": orden.canal_compra or "",
        "marca": orden.marca or "",
        "pago_msi": orden.pago_msi or 0,
        "meses_msi": orden.meses_msi or 1,
        "creado": orden.creado,
        "actualizado": orden.actualizado,
        "items": [_item_to_dict(it) for it in items],
    }


async def _get_items(db: AsyncSession, orden_id: int):
    q = await db.execute(
        select(models.OrdenCompraItem).where(models.OrdenCompraItem.orden_id == orden_id)
    )
    return q.scalars().all()


@app.get("/ordenes-compra", response_model=List[schemas.OrdenCompraOut],
         dependencies=[Depends(require_role("admin"))])
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
    out = []
    for orden in ordenes:
        items = await _get_items(db, orden.id)
        out.append(_orden_to_dict(orden, items))
    return out


@app.get("/ordenes-compra/{orden_id}", response_model=schemas.OrdenCompraOut,
         dependencies=[Depends(require_role("admin"))])
async def obtener_orden(orden_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(models.OrdenCompra).where(models.OrdenCompra.id == orden_id)
    )
    orden = result.scalar_one_or_none()
    if not orden:
        raise HTTPException(status_code=404, detail="Orden no encontrada")
    items = await _get_items(db, orden_id)
    return _orden_to_dict(orden, items)


@app.post("/ordenes-compra", response_model=schemas.OrdenCompraOut, status_code=201,
          dependencies=[Depends(require_role("admin"))])
async def crear_orden(
    data: schemas.OrdenCompraCreate,
    db: AsyncSession = Depends(get_db)
):
    folio = _generar_folio()
    while True:
        existing = await db.execute(
            select(models.OrdenCompra).where(models.OrdenCompra.folio == folio)
        )
        if not existing.scalar_one_or_none():
            break
        folio = _generar_folio()

    total = sum(it.qty * it.precio_proveedor for it in data.items)

    orden = models.OrdenCompra(
        folio=folio,
        proveedor=data.proveedor,
        estado="borrador",
        total_estimado=total,
        notas=data.notas,
        tipo_compra=data.tipo_compra,
        canal_compra=data.canal_compra,
        marca=data.marca,
        pago_msi=data.pago_msi,
        meses_msi=data.meses_msi,
    )
    db.add(orden)
    await db.flush()  # obtener id de la orden

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
            es_obligatoria=it.es_obligatoria
        )
        db.add(item)

    await db.flush()  # obtener IDs de los items
    await db.commit()
    await db.refresh(orden)

    items = await _get_items(db, orden.id)
    return _orden_to_dict(orden, items)


@app.put("/ordenes-compra/{orden_id}", response_model=schemas.OrdenCompraOut,
         dependencies=[Depends(require_role("admin"))])
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
    if orden.estado != "borrador":
        raise HTTPException(status_code=400, detail="Solo se puede editar una orden en borrador")

    if data.proveedor is not None:
        orden.proveedor = data.proveedor
    if data.notas is not None:
        orden.notas = data.notas
    if data.tipo_compra is not None:
        orden.tipo_compra = data.tipo_compra
    if data.canal_compra is not None:
        orden.canal_compra = data.canal_compra
    if data.marca is not None:
        orden.marca = data.marca
    if data.pago_msi is not None:
        orden.pago_msi = data.pago_msi
    if data.meses_msi is not None:
        orden.meses_msi = data.meses_msi

    if data.items is not None:
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
                es_obligatoria=it.es_obligatoria
            )
            db.add(item)
        orden.total_estimado = total
        await db.flush()

    await db.commit()
    await db.refresh(orden)
    items = await _get_items(db, orden_id)
    return _orden_to_dict(orden, items)


@app.post("/ordenes-compra/{orden_id}/estado", response_model=schemas.OrdenCompraOut,
          dependencies=[Depends(require_role("admin"))])
async def cambiar_estado_orden(
    orden_id: int,
    data: schemas.EstadoOrdenIn,
    db: AsyncSession = Depends(get_db)
):
    nuevo_estado = data.estado.lower()
    if nuevo_estado not in ("enviada", "confirmada", "cancelada"):
        raise HTTPException(status_code=400, detail="estado debe ser 'enviada', 'confirmada' o 'cancelada'")

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

    elif nuevo_estado == "cancelada":
        if orden.estado == "confirmada":
            raise HTTPException(status_code=400, detail="No se puede cancelar una orden ya confirmada")
        orden.estado = "cancelada"
        await db.commit()

    elif nuevo_estado == "confirmada":
        if orden.estado not in ("borrador", "enviada"):
            raise HTTPException(status_code=400, detail="Solo se puede confirmar una orden en borrador o enviada")

        if orden.tipo_compra == "ropa":
            items = await _get_items(db, orden_id)
            for it in items:
                if not it.producto_id:
                    continue
                prod_result = await db.execute(
                    select(models.Producto).where(models.Producto.id == it.producto_id)
                )
                producto = prod_result.scalar_one_or_none()
                if not producto:
                    continue
                producto.qty += it.qty
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

        await services.registrar_egreso_orden(db, orden)

        orden.estado = "confirmada"
        await db.commit()

    await db.refresh(orden)
    items_final = await _get_items(db, orden_id)
    return _orden_to_dict(orden, items_final)


@app.post("/ordenes-compra/{orden_id}/duplicar", response_model=schemas.OrdenCompraOut,
          dependencies=[Depends(require_role("admin"))])
async def duplicar_orden(
    orden_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(get_current_user)
):
    """Duplica una orden de compra existente como un nuevo borrador."""
    # Obtener la orden original
    result = await db.execute(
        select(models.OrdenCompra).where(models.OrdenCompra.id == orden_id)
    )
    orden_original = result.scalar_one_or_none()
    if not orden_original:
        raise HTTPException(status_code=404, detail="Orden no encontrada")

    # Generar folio único
    folio = _generar_folio()
    while True:
        existing = await db.execute(
            select(models.OrdenCompra).where(models.OrdenCompra.folio == folio)
        )
        if not existing.scalar_one_or_none():
            break
        folio = _generar_folio()

    # Obtener items originales
    items_originales = await _get_items(db, orden_id)

    # Calcular total
    total = sum((it.qty or 0) * (it.precio_proveedor or 0) for it in items_originales)

    # Crear nueva orden en borrador
    nueva_orden = models.OrdenCompra(
        folio=folio,
        proveedor=orden_original.proveedor or "",
        estado="borrador",
        total_estimado=total,
        notas=f"Duplicada de {orden_original.folio}. {orden_original.notas or ''}".strip(),
        tipo_compra=orden_original.tipo_compra,
        canal_compra=orden_original.canal_compra,
        marca=orden_original.marca,
        pago_msi=orden_original.pago_msi,
        meses_msi=orden_original.meses_msi,
    )
    db.add(nueva_orden)
    await db.flush()

    # Clonar items
    for it in items_originales:
        subtotal = (it.qty or 0) * (it.precio_proveedor or 0)
        nuevo_item = models.OrdenCompraItem(
            orden_id=nueva_orden.id,
            producto_id=it.producto_id,
            producto_nombre=it.producto_nombre or "",
            publico=it.publico or "",
            genero=it.genero or "",
            color=it.color or "",
            talla=it.talla or "",
            qty=it.qty,
            precio_proveedor=it.precio_proveedor or 0.0,
            subtotal=subtotal,
            es_obligatoria=it.es_obligatoria or 0
        )
        db.add(nuevo_item)


    await db.flush()
    await db.commit()
    await db.refresh(nueva_orden)

    # Audit log
    await services.registrar_log(
        db, usuario_id=current_user.id, username=current_user.username,
        accion="DUPLICAR_OC", recurso="OrdenCompra", recurso_id=str(nueva_orden.id),
        detalles={"original_folio": orden_original.folio, "nuevo_folio": folio}
    )

    items_nuevos = await _get_items(db, nueva_orden.id)
    return _orden_to_dict(nueva_orden, items_nuevos)


# ── CATÁLOGO DE INSUMOS ──────────────────────────────────────────────

@app.get("/insumos", response_model=List[schemas.CatalogoInsumoOut], dependencies=[Depends(require_role("admin", "vendedor", "bodeguero"))])
async def listar_insumos(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(models.CatalogoInsumo).order_by(models.CatalogoInsumo.nombre))
    return result.scalars().all()

@app.post("/insumos", response_model=schemas.CatalogoInsumoOut, status_code=201, dependencies=[Depends(require_role("admin"))])
async def crear_insumo(data: schemas.CatalogoInsumoCreate, db: AsyncSession = Depends(get_db)):
    nuevo = models.CatalogoInsumo(nombre=data.nombre, descripcion=data.descripcion)
    db.add(nuevo)
    await db.commit()
    await db.refresh(nuevo)
    return nuevo

@app.put("/insumos/{id}", response_model=schemas.CatalogoInsumoOut, dependencies=[Depends(require_role("admin"))])
async def actualizar_insumo(id: int, data: schemas.CatalogoInsumoUpdate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(models.CatalogoInsumo).where(models.CatalogoInsumo.id == id))
    insumo = result.scalar_one_or_none()
    if not insumo:
        raise HTTPException(status_code=404, detail="Insumo no encontrado")
    if data.nombre is not None:
        insumo.nombre = data.nombre
    if data.descripcion is not None:
        insumo.descripcion = data.descripcion
    await db.commit()
    await db.refresh(insumo)
    return insumo

@app.delete("/insumos/{id}", status_code=204, dependencies=[Depends(require_role("admin"))])
async def eliminar_insumo(id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(models.CatalogoInsumo).where(models.CatalogoInsumo.id == id))
    insumo = result.scalar_one_or_none()
    if not insumo:
        raise HTTPException(status_code=404, detail="Insumo no encontrado")
    await db.delete(insumo)
    await db.commit()

# ── CONTABILIDAD ─────────────────────────────────────────────────────

@app.post("/contabilidad/transaccion", response_model=schemas.ContabilidadTransaccionOut, status_code=201, dependencies=[Depends(require_role("admin"))])
async def registrar_transaccion_contable(data: schemas.ContabilidadTransaccionCreate, db: AsyncSession = Depends(get_db)):
    tx = models.ContabilidadTransaccion(
        tipo=data.tipo,
        monto=data.monto,
        fecha=data.fecha,
        procedencia_destino=data.procedencia_destino,
        concepto=data.concepto,
        referencia_id=data.referencia_id
    )
    db.add(tx)
    await db.commit()
    await db.refresh(tx)
    return tx

@app.get("/contabilidad/reporte", dependencies=[Depends(require_role("admin"))])
async def reporte_contabilidad(mes: int = Query(None), anio: int = Query(None), db: AsyncSession = Depends(get_db)):
    now = datetime.now()
    m = mes or now.month
    y = anio or now.year
    
    from sqlalchemy import extract
    q = select(models.ContabilidadTransaccion).where(
        extract('month', models.ContabilidadTransaccion.fecha) == m,
        extract('year', models.ContabilidadTransaccion.fecha) == y
    ).order_by(models.ContabilidadTransaccion.fecha.desc())
    
    result = await db.execute(q)
    transacciones = result.scalars().all()
    
    ingresos = sum(t.monto for t in transacciones if t.tipo == "ingreso")
    egresos = sum(t.monto for t in transacciones if t.tipo == "egreso")
    balance = ingresos - egresos
    
    return {
        "mes": m,
        "anio": y,
        "ingresos": ingresos,
        "egresos": egresos,
        "balance": balance,
        "transacciones": [
            {
                "id": t.id,
                "tipo": t.tipo,
                "monto": t.monto,
                "fecha": t.fecha,
                "procedencia_destino": t.procedencia_destino,
                "concepto": t.concepto,
                "referencia_id": t.referencia_id
            } for t in transacciones
        ]
    }
