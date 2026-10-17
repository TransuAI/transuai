"""action proposals: the fingerprint of what a carried-out proposal created

Revision ID: 0015
Revises: 0014
Create Date: 2026-09-28
"""
from alembic import op
import sqlalchemy as sa

revision = "0015"
down_revision = "0014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("action_proposals", sa.Column("fingerprint", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("action_proposals", "fingerprint")
