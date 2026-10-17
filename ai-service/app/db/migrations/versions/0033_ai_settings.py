"""ai_settings: the models the administrator saved on the system settings page (one row; none means the environment
variables are used)

Revision ID: 0033
Revises: 0032
Create Date: 2026-10-18
"""
from alembic import op
import sqlalchemy as sa

revision = "0033"
down_revision = "0032"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "ai_settings",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("platform_base_url", sa.String(500), nullable=False, server_default=""),
        sa.Column("platform_api_key", sa.LargeBinary, nullable=True),
        sa.Column("platform_model", sa.String(200), nullable=False, server_default=""),
        sa.Column("post_meeting_model", sa.String(200), nullable=False, server_default=""),
        sa.Column("embedding_base_url", sa.String(500), nullable=False, server_default=""),
        sa.Column("embedding_api_key", sa.LargeBinary, nullable=True),
        sa.Column("embedding_model", sa.String(200), nullable=False, server_default=""),
        sa.Column("embedding_query_instruction", sa.Text, nullable=False, server_default=""),
        sa.Column("web_search_api_key", sa.LargeBinary, nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("ai_settings")
