import asyncio
import sys
import os

# Add backend directory to sys.path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from app.database import engine
from sqlalchemy import text

async def run_migration():
    async with engine.begin() as conn:
        try:
            await conn.execute(text("ALTER TABLE ordenes_compra_items ADD COLUMN es_obligatoria INTEGER DEFAULT 0;"))
            print("Columna 'es_obligatoria' agregada exitosamente a 'ordenes_compra_items'.")
        except Exception as e:
            print(f"Error o la columna ya existe: {e}")

if __name__ == "__main__":
    asyncio.run(run_migration())
