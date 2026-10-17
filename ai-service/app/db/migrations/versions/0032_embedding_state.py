"""embedding_state: which embedding model made the stored vectors (one row). Existing vectors were made by BAAI/bge-m3
on Hugging Face, the only model used before; a database without any vectors starts with none.

Revision ID: 0032
Revises: 0031
Create Date: 2026-10-17
"""
from alembic import op
import sqlalchemy as sa

revision = "0032"
down_revision = "0031"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "embedding_state",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("model", sa.String(200), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.execute(
        "INSERT INTO embedding_state (id, model, updated_at) SELECT 1, "
        "CASE WHEN EXISTS (SELECT 1 FROM embeddings) OR EXISTS (SELECT 1 FROM decisions WHERE embedding IS NOT NULL) "
        "THEN 'BAAI/bge-m3' END, now()"
    )


def downgrade() -> None:
    op.drop_table("embedding_state")
