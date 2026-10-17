"""action proposal execution: status, result link, failure reason

Revision ID: 0012
Revises: 0011
Create Date: 2026-09-27
"""
from alembic import op
import sqlalchemy as sa

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("action_proposals", sa.Column("status", sa.String(10), nullable=False, server_default="PROPOSED"))
    op.add_column("action_proposals", sa.Column("result_url", sa.Text(), nullable=True))
    op.add_column("action_proposals", sa.Column("failure_reason", sa.Text(), nullable=True))
    op.add_column("action_proposals", sa.Column("executed_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("action_proposals", "executed_at")
    op.drop_column("action_proposals", "failure_reason")
    op.drop_column("action_proposals", "result_url")
    op.drop_column("action_proposals", "status")
