"""Add devoluciones (playeras devueltas) — migración idempotente

Crea la tabla devoluciones: piezas devueltas por clientes listas para re-vender,
con foto de diseño obligatoria (archivo en uploads/devoluciones/).

Idempotente a propósito: el lifespan de la API ejecuta create_all como
respaldo, por lo que la tabla puede existir antes de correr esta migración.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c4d9e7a12f63'
down_revision: Union[str, None] = 'a3f8c2d91b47'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if not inspector.has_table("devoluciones"):
        op.create_table(
            "devoluciones",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("producto_id", sa.Integer(),
                      sa.ForeignKey("productos.id", ondelete="SET NULL"),
                      nullable=True),
            sa.Column("producto_nombre", sa.String(length=200), server_default=""),
            sa.Column("color", sa.String(length=100), server_default=""),
            sa.Column("talla", sa.String(length=50), server_default=""),
            sa.Column("variante", sa.String(length=200), server_default=""),
            sa.Column("diseno", sa.String(length=300), server_default=""),
            sa.Column("imagen", sa.String(length=300), server_default=""),
            sa.Column("qty", sa.Integer(), server_default="1"),
            sa.Column("precio", sa.Numeric(12, 2), server_default="0"),
            sa.Column("folio_origen", sa.String(length=50), server_default=""),
            sa.Column("motivo", sa.String(length=100), server_default=""),
            sa.Column("notas", sa.Text(), server_default=""),
            sa.Column("estado", sa.String(length=20), server_default="disponible"),
            sa.Column("fecha_ingreso", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("fecha_salida", sa.DateTime(timezone=True), nullable=True),
        )
        op.create_index("ix_devoluciones_id", "devoluciones", ["id"], unique=False)
        op.create_index("ix_devoluciones_producto_id", "devoluciones", ["producto_id"], unique=False)
        op.create_index("ix_devoluciones_estado", "devoluciones", ["estado"], unique=False)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if inspector.has_table("devoluciones"):
        op.drop_table("devoluciones")
