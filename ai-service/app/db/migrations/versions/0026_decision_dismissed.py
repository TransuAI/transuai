"""decisions.dismissed: an extracted decision the user deleted stays hidden, so extracting again doesn't bring it back

Revision ID: 0026
Revises: 0025
Create Date: 2026-10-04
"""
from alembic import op
import sqlalchemy as sa

revision = "0026"
down_revision = "0025"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("decisions", sa.Column("dismissed", sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade() -> None:
    op.drop_column("decisions", "dismissed")
