"""
auth.py — Módulo central de autenticación para Inventario Pro.
Provee utilidades de hash, generación/validación de JWT y
dependencias reutilizables para proteger rutas por rol.
"""

import os
from datetime import datetime, timedelta
from typing import Optional

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db

# ── Configuración ────────────────────────────────────────────────────────────
SECRET_KEY = os.getenv("SECRET_KEY", "inventario_super_secret_key_dev_only_change_in_prod")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_HOURS = 8

# ── Contexto de hashing ──────────────────────────────────────────────────────
pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")

# ── Esquema de seguridad (Bearer Token) ─────────────────────────────────────
bearer_scheme = HTTPBearer(auto_error=False)


# ── Funciones de contraseña ──────────────────────────────────────────────────

def hash_password(plain: str) -> str:
    """Retorna el hash bcrypt de la contraseña en texto plano."""
    return pwd_context.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    """Verifica si una contraseña en texto plano coincide con el hash."""
    return pwd_context.verify(plain, hashed)


# ── Funciones de JWT ─────────────────────────────────────────────────────────

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """Genera un JWT firmado con los datos provistos."""
    to_encode = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(hours=ACCESS_TOKEN_EXPIRE_HOURS))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def decode_token(token: str) -> dict:
    """Decodifica y valida un JWT. Lanza HTTPException si es inválido o expirado."""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token inválido o expirado",
            headers={"WWW-Authenticate": "Bearer"},
        )


# ── Dependencias FastAPI ─────────────────────────────────────────────────────

async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
):
    """
    Dependencia que extrae y valida el JWT del header Authorization.
    Retorna el objeto Usuario activo desde la BD.
    """
    from app.models import Usuario  # import local para evitar circularidad

    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="No se proporcionó token de autenticación",
            headers={"WWW-Authenticate": "Bearer"},
        )

    payload = decode_token(credentials.credentials)
    username: str = payload.get("sub")
    if not username:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token malformado")

    result = await db.execute(select(Usuario).where(Usuario.username == username))
    user = result.scalar_one_or_none()

    if user is None or user.activo == 0:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Usuario no encontrado o desactivado")

    return user


def require_role(*allowed_roles: str):
    """
    Fábrica de dependencias que verifica que el usuario activo tenga uno de los roles permitidos.

    Uso:
        @app.get("/ruta", dependencies=[Depends(require_role("admin", "bodeguero"))])
    """
    async def _check(current_user=Depends(get_current_user)):
        if current_user.rol not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Acceso denegado. Se requiere rol: {' o '.join(allowed_roles)}",
            )
        return current_user
    return _check
