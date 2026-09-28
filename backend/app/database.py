from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import declarative_base
from dotenv import load_dotenv
import os

# Probar varias rutas para el archivo .env
paths_to_try = [
    os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '.env')),
    os.path.join(os.getcwd(), ".env"),
]
for p in paths_to_try:
    if os.path.exists(p):
        load_dotenv(p)
        break

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql+asyncpg://inventario:inventario_secret_pwd_123@localhost:5432/inventario_db"
)
# If the URL still points to the Docker service name, replace it for local execution
if not os.getenv("IS_DOCKER") and "@db:" in DATABASE_URL:
    DATABASE_URL = DATABASE_URL.replace("@db:", "@localhost:")

engine = create_async_engine(DATABASE_URL, echo=False)
SessionLocal = async_sessionmaker(
    bind=engine,
    expire_on_commit=False,
    autoflush=False
)
Base = declarative_base()

async def get_db():
    async with SessionLocal() as db:
        yield db
