"""qa history: whether a question searched the web, and the web sources its answer drew on

Revision ID: 0017
Revises: 0016
Create Date: 2026-09-29
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0017"
down_revision = "0016"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Questions from before this didn't search the web.
    op.add_column("qa_history", sa.Column("web_search", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("qa_history", sa.Column("web_sources", postgresql.JSONB(), nullable=False,
                                          server_default=sa.text("'[]'::jsonb")))


def downgrade() -> None:
    op.drop_column("qa_history", "web_sources")
    op.drop_column("qa_history", "web_search")
