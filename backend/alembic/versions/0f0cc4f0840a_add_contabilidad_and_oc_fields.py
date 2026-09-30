"""Add Contabilidad and OC fields — migración idempotente (baseline + ajustes)

Comportamiento corregido el 2026-09-30:

- Base de datos VACÍA: crea todo el esquema actual a partir de app.models
  (Base.metadata.create_all) y deja el sello de Alembic en esta revisión.
  Antes esta migración fallaba en una BD nueva porque asumía que las tablas
  ya existían (las creaba create_all del lifespan, no Alembic).
- Base de datos con tablas creadas por create_all (instalaciones anteriores):
  sólo agrega lo que falte, sin fallar por objetos ya existentes.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

from app import models


revision: str = '0f0cc4f0840a'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()

    # 1) Baseline: garantiza que existan todas las tablas del esquema actual.
    models.Base.metadata.create_all(bind=bind)

    inspector = sa.inspect(bind)

    # 2) Columnas incrementales de ordenes_compra (sólo si faltan).
    if inspector.has_table("ordenes_compra"):
        columnas = {c["name"] for c in inspector.get_columns("ordenes_compra")}
        nuevas = [
            ("tipo_compra", sa.String(length=50)),
            ("canal_compra", sa.String(length=100)),
            ("marca", sa.String(length=100)),
            ("pago_msi", sa.Integer()),
            ("meses_msi", sa.Integer()),
        ]
        for nombre, tipo in nuevas:
            if nombre not in columnas:
                op.add_column("ordenes_compra", sa.Column(nombre, tipo, nullable=True))

    # 3) Índice único de usuarios.email (sólo si falta).
    if inspector.has_table("usuarios"):
        indices = {i["name"] for i in inspector.get_indexes("usuarios")}
        if "ix_usuarios_email" not in indices:
            op.create_index(op.f("ix_usuarios_email"), "usuarios", ["email"], unique=True)

    # 4) FK de movimientos.producto_id → productos.id (sólo si falta).
    if inspector.has_table("movimientos"):
        fks = inspector.get_foreign_keys("movimientos")
        tiene_fk = any(f.get("referred_table") == "productos" for f in fks)
        if not tiene_fk:
            op.create_foreign_key(
                "fk_movimientos_producto_id",
                "movimientos", "productos",
                ["producto_id"], ["id"],
                ondelete="SET NULL",
            )


def downgrade() -> None:
    op.drop_constraint("fk_movimientos_producto_id", "movimientos", type_="foreignkey")
    op.drop_index(op.f("ix_usuarios_email"), table_name="usuarios")
    op.drop_column("ordenes_compra", "meses_msi")
    op.drop_column("ordenes_compra", "pago_msi")
    op.drop_column("ordenes_compra", "marca")
    op.drop_column("ordenes_compra", "canal_compra")
    op.drop_column("ordenes_compra", "tipo_compra")
