"""
Script de emergencia (ejecución manual dentro del contenedor):
  1. Resetea el 2FA del usuario admin (TOTP + passkeys)
  2. Re-establece su contraseña con el valor de ADMIN_RESET_PASSWORD
  3. Asegura que el usuario esté activo

Uso (la contraseña NUNCA va en el código; se pasa por variable de entorno):
  docker exec -e ADMIN_RESET_PASSWORD='<nueva-contraseña>' inventario_api python -m app.reset_admin_2fa
"""
import asyncio
import os
import sys

from app.database import SessionLocal
from app import models
from app.auth import hash_password
from sqlalchemy import select, delete


async def reset_admin():
    nueva_password = os.getenv("ADMIN_RESET_PASSWORD")
    if not nueva_password:
        sys.exit("Falta ADMIN_RESET_PASSWORD (contraseña nueva para el usuario admin).")

    async with SessionLocal() as db:
        q = await db.execute(select(models.Usuario).where(models.Usuario.username == 'admin'))
        u = q.scalar_one_or_none()
        if u:
            # 1. Resetear 2FA
            u.totp_enabled = 0
            u.totp_secret = None

            # 1b. Eliminar passkeys (WebAuthn) del admin
            await db.execute(
                delete(models.WebAuthnCredential).where(
                    models.WebAuthnCredential.usuario_id == u.id
                )
            )

            # 2. Re-hashear contraseña
            u.password_hash = hash_password(nueva_password)

            # 3. Asegurar que esté activo
            u.activo = 1

            await db.commit()
            print("=" * 55)
            print("  ✅  RESET DE EMERGENCIA COMPLETADO")
            print("  • 2FA DESACTIVADO (TOTP + passkeys eliminadas)")
            print("  • Contraseña actualizada (la de ADMIN_RESET_PASSWORD)")
            print("  • Estado: ACTIVO")
            print("=" * 55)
        else:
            print("❌ USUARIO admin NO ENCONTRADO — creándolo...")
            admin = models.Usuario(
                username="admin",
                nombre="Administrador Principal",
                email="admin@inventario.pro",
                password_hash=hash_password(nueva_password),
                rol="admin",
                activo=1,
                totp_enabled=0,
                totp_secret=None,
            )
            db.add(admin)
            await db.commit()
            print("✅ USUARIO ADMIN CREADO con la contraseña de ADMIN_RESET_PASSWORD")


if __name__ == "__main__":
    asyncio.run(reset_admin())
