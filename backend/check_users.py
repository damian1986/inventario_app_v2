import asyncio
import os
import sys

# Añadir directorio raíz al sys.path para poder importar 'app'
# Estamos en d:\35 - Docker Compose\01 - App Inventario\inventario_app_v2\backend
sys.path.append(os.getcwd())

from app.database import SessionLocal
from app.models import Usuario
from sqlalchemy import select

async def check():
    print("--- INICIO DE VERIFICACION ---")
    try:
        async with SessionLocal() as db:
            res = await db.execute(select(Usuario))
            users = res.scalars().all()
            if not users:
                print("No se encontraron usuarios.")
            for u in users:
                print(f"User: {u.username} | Nombre: '{u.nombre}' | Email: {u.email} | ID: {u.id}")
    except Exception as e:
        print(f"ERROR: {e}")
    print("--- FIN DE VERIFICACION ---")

if __name__ == "__main__":
    asyncio.run(check())
