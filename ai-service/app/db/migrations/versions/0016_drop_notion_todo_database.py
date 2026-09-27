"""post-meeting settings: drop the Notion todo database (todos now go into each meeting's Notion page)

Revision ID: 0016
Revises: 0015
Create Date: 2026-09-28
"""
from alembic import op
import sqlalchemy as sa

revision = "0016"
down_revision = "0015"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_column("post_meeting_settings", "notion_todo_data_source_id")
    op.drop_column("post_meeting_settings", "notion_todo_database_title")
    op.drop_column("post_meeting_settings", "notion_todo_database_url")


def downgrade() -> None:
    op.add_column("post_meeting_settings", sa.Column("notion_todo_database_url", sa.Text(), nullable=True))
    op.add_column("post_meeting_settings", sa.Column("notion_todo_database_title", sa.Text(), nullable=True))
    op.add_column("post_meeting_settings", sa.Column("notion_todo_data_source_id", sa.String(64), nullable=True))
