import asyncio
import os
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text
from dotenv import load_dotenv

load_dotenv()
DATABASE_URL = os.getenv("DATABASE_URL")

async def migrate():
    engine = create_async_engine(DATABASE_URL)
    async with engine.begin() as conn:
        print("Añadiendo columna notas_internas...")
        try:
            await conn.execute(text("ALTER TABLE productos ADD COLUMN notas_internas TEXT DEFAULT '';"))
        except Exception as e:
            print(f"Nota: {e}")
            
        print("Añadiendo columna proveedores_alternativos...")
        try:
            await conn.execute(text("ALTER TABLE productos ADD COLUMN proveedores_alternativos VARCHAR(500) DEFAULT '';"))
        except Exception as e:
            print(f"Nota: {e}")
            
    await engine.dispose()
    print("Migración completada.")

if __name__ == "__main__":
    asyncio.run(migrate())
