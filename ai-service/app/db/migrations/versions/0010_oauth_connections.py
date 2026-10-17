"""oauth connections: linked Google / Notion accounts, pending authorizations, registered Notion clients

Revision ID: 0010
Revises: 0009
Create Date: 2026-09-27
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "oauth_connections",
        sa.Column("user_id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("service", sa.String(16), primary_key=True),
        sa.Column("status", sa.String(10), nullable=False),
        sa.Column("encrypted_access_token", sa.LargeBinary(), nullable=False),
        sa.Column("encrypted_refresh_token", sa.LargeBinary(), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("client_id", sa.String(200), nullable=False),
        sa.Column("connected_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "oauth_pending_authorizations",
        sa.Column("state", sa.String(64), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("service", sa.String(16), nullable=False),
        sa.Column("redirect_uri", sa.Text(), nullable=False),
        sa.Column("client_id", sa.String(200), nullable=False),
        sa.Column("browser_binding_hash", sa.String(64), nullable=False),
        sa.Column("code_verifier", sa.String(128), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "oauth_clients",
        sa.Column("service", sa.String(16), primary_key=True),
        sa.Column("redirect_uri", sa.Text(), primary_key=True),
        sa.Column("client_id", sa.String(200), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("oauth_clients")
    op.drop_table("oauth_pending_authorizations")
    op.drop_table("oauth_connections")
