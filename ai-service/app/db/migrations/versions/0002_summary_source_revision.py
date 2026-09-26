"""summary source revision: which transcript revision a summary was built from

Revision ID: 0002
Revises: 0001
Create Date: 2026-09-26

Existing summaries were built before transcripts could be edited, i.e. from revision 0.
"""
from alembic import op
import sqlalchemy as sa

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("summaries", sa.Column("source_revision", sa.Integer(), nullable=False, server_default="0"))


def downgrade() -> None:
    op.drop_column("summaries", "source_revision")
