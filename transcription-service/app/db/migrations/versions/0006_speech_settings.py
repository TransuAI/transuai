"""speech_settings: the speech recognition the administrator saved on the system settings page (one row; none means the
environment variables are used)

Revision ID: 0006
Revises: 0005
Create Date: 2026-10-18
"""
from alembic import op
import sqlalchemy as sa

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "speech_settings",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("stt_base_url", sa.String(500), nullable=False, server_default=""),
        sa.Column("stt_api_key", sa.LargeBinary, nullable=True),
        sa.Column("stt_model", sa.String(200), nullable=False, server_default=""),
        sa.Column("deepgram_api_key", sa.LargeBinary, nullable=True),
        sa.Column("diarization_threshold", sa.Float, nullable=False, server_default="0.6"),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("speech_settings")
