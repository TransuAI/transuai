"""summary regeneration: status of a user-requested regeneration of summary and chapters

Revision ID: 0003
Revises: 0002
Create Date: 2026-09-26
"""
from alembic import op
import sqlalchemy as sa

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("summaries", sa.Column("regeneration_status", sa.String(10), nullable=False, server_default="IDLE"))
    op.add_column("summaries", sa.Column("regeneration_requested_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("summaries", "regeneration_requested_at")
    op.drop_column("summaries", "regeneration_status")
