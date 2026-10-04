"""translations.progressed_at: when the last batch was saved, so a long translation still going isn't taken for stuck

Revision ID: 0024
Revises: 0023
Create Date: 2026-10-04
"""
from alembic import op
import sqlalchemy as sa

revision = "0024"
down_revision = "0023"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("translations", sa.Column("progressed_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("translations", "progressed_at")
