"""default models: each user's chosen model; summaries remember the model that made them

Revision ID: 0006
Revises: 0005
Create Date: 2026-09-26
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "default_models",
        sa.Column("user_id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("provider", sa.String(32), nullable=False),
        sa.Column("model", sa.String(200), nullable=False),
        sa.Column("supports_tools", sa.Boolean(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    # Summaries made before this don't know their model: left empty.
    op.add_column("summaries", sa.Column("model_provider", sa.String(32), nullable=True))
    op.add_column("summaries", sa.Column("model", sa.String(200), nullable=True))


def downgrade() -> None:
    op.drop_column("summaries", "model")
    op.drop_column("summaries", "model_provider")
    op.drop_table("default_models")
