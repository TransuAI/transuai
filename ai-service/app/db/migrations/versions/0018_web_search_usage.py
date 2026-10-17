"""web search usage: one row per web search a question made (succeeded or not)

Revision ID: 0018
Revises: 0017
Create Date: 2026-09-29
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0018"
down_revision = "0017"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "web_search_usage",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("job_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("provider", sa.String(32), nullable=False),
        sa.Column("succeeded", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_web_search_usage_user_id", "web_search_usage", ["user_id"])
    op.create_index("ix_web_search_usage_job_id", "web_search_usage", ["job_id"])


def downgrade() -> None:
    op.drop_index("ix_web_search_usage_job_id", table_name="web_search_usage")
    op.drop_index("ix_web_search_usage_user_id", table_name="web_search_usage")
    op.drop_table("web_search_usage")
