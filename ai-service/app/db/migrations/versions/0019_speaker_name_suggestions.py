"""speaker name suggestions: the name the recording itself gives a speaker, with the line that says so

Revision ID: 0019
Revises: 0018
Create Date: 2026-09-30
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0019"
down_revision = "0018"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "speaker_name_suggestions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("job_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("speaker_label", sa.String(32), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("evidence_start_time", sa.Numeric(10, 2), nullable=False),
        sa.Column("evidence_text", sa.Text(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_speaker_name_suggestions_job_id", "speaker_name_suggestions", ["job_id"])


def downgrade() -> None:
    op.drop_index("ix_speaker_name_suggestions_job_id", table_name="speaker_name_suggestions")
    op.drop_table("speaker_name_suggestions")
