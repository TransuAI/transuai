"""translations (譯文): a job's transcript in another language, one line per segment

Revision ID: 0023
Revises: 0022
Create Date: 2026-10-04
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0023"
down_revision = "0022"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "translations",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("job_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("language", sa.String(8), nullable=False),
        sa.Column("requested_by", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("status", sa.String(10), nullable=False),
        sa.Column("failure_reason", sa.Text(), nullable=True),
        sa.Column("total_segments", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("model_provider", sa.String(32), nullable=True),
        sa.Column("model", sa.String(200), nullable=True),
        sa.Column("requested_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("job_id", "language"),
    )
    op.create_index("ix_translations_job_id", "translations", ["job_id"])
    op.create_table(
        "segment_translations",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("translation_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("translations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("segment_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("source_text", sa.Text(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.UniqueConstraint("translation_id", "segment_id"),
    )
    op.create_index("ix_segment_translations_translation_id", "segment_translations", ["translation_id"])


def downgrade() -> None:
    op.drop_table("segment_translations")
    op.drop_table("translations")
