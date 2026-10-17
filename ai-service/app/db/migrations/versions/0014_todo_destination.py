"""post-meeting settings: where todos go (Google Tasks or Notion)

Revision ID: 0014
Revises: 0013
Create Date: 2026-09-28
"""
from alembic import op
import sqlalchemy as sa

revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("post_meeting_settings", sa.Column(
        "todo_destination", sa.String(20), nullable=False, server_default="google_tasks"))
    # 已經指定了 Notion 待辦資料庫的人，待辦原本就寫進 Notion：維持原本的行為。
    op.execute("UPDATE post_meeting_settings SET todo_destination = 'notion' WHERE notion_todo_data_source_id IS NOT NULL")


def downgrade() -> None:
    op.drop_column("post_meeting_settings", "todo_destination")
