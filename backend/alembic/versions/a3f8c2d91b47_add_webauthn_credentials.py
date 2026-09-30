"""Add WebAuthn credentials (passkeys) — migración idempotente

Crea la tabla webauthn_credentials (llaves públicas de passkeys por usuario).

Idempotente a propósito: el lifespan de la API ejecuta create_all como
respaldo, por lo que la tabla puede existir antes de correr esta migración.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a3f8c2d91b47'
down_revision: Union[str, None] = '0f0cc4f0840a'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if not inspector.has_table("webauthn_credentials"):
        op.create_table(
            "webauthn_credentials",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("usuario_id", sa.Integer(),
                      sa.ForeignKey("usuarios.id", ondelete="CASCADE"),
                      nullable=False),
            sa.Column("credential_id", sa.String(length=255), nullable=False),
            sa.Column("public_key", sa.Text(), nullable=False),
            sa.Column("sign_count", sa.Integer(), server_default="0"),
            sa.Column("transports", sa.String(length=100), server_default=""),
            sa.Column("nombre", sa.String(length=100), server_default=""),
            sa.Column("creado", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("ultimo_uso", sa.DateTime(timezone=True), nullable=True),
        )
        op.create_index("ix_webauthn_credentials_id", "webauthn_credentials", ["id"], unique=False)
        op.create_index("ix_webauthn_credentials_usuario_id", "webauthn_credentials", ["usuario_id"], unique=False)
        op.create_index("ix_webauthn_credentials_credential_id", "webauthn_credentials", ["credential_id"], unique=True)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if inspector.has_table("webauthn_credentials"):
        op.drop_table("webauthn_credentials")
