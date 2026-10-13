"""web_search_usage.feature: what a search was for — qa (Q&A's web search) or fact_check; existing rows were Q&A's

Revision ID: 0031
Revises: 0030
Create Date: 2026-10-04
"""
from alembic import op
import sqlalchemy as sa

revision = "0031"
down_revision = "0030"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("web_search_usage", sa.Column("feature", sa.String(16), nullable=False, server_default="qa"))


def downgrade() -> None:
    op.drop_column("web_search_usage", "feature")
