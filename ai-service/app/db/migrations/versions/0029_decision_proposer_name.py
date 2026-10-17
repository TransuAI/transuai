"""decisions.proposed_by_name: the proposer's current name, for pages across jobs (which have no transcript to look it up)

Revision ID: 0029
Revises: 0028
Create Date: 2026-10-04
"""
from alembic import op
import sqlalchemy as sa

revision = "0029"
down_revision = "0028"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("decisions", sa.Column("proposed_by_name", sa.String(100), nullable=True))


def downgrade() -> None:
    op.drop_column("decisions", "proposed_by_name")
