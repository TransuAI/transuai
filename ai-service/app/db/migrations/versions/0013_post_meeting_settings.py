"""post-meeting settings: where Notion meeting notes and todos go

Revision ID: 0013
Revises: 0012
Create Date: 2026-09-27
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "post_meeting_settings",
        sa.Column("user_id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("notion_meetings_page_id", sa.String(64), nullable=True),
        sa.Column("notion_meetings_page_title", sa.Text(), nullable=True),
        sa.Column("notion_meetings_page_url", sa.Text(), nullable=True),
        sa.Column("notion_todo_data_source_id", sa.String(64), nullable=True),
        sa.Column("notion_todo_database_title", sa.Text(), nullable=True),
        sa.Column("notion_todo_database_url", sa.Text(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("post_meeting_settings")
