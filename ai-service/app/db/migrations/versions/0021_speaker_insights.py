"""speaker insights: the questions each speaker asks and possible interruptions, judged by the model

Revision ID: 0021
Revises: 0020
Create Date: 2026-10-03
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0021"
down_revision = "0020"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "speaker_insights",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("job_id", postgresql.UUID(as_uuid=True), nullable=False, unique=True),
        sa.Column("requested_by", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("status", sa.String(10), nullable=False),
        sa.Column("failure_reason", sa.Text(), nullable=True),
        sa.Column("source_revision", sa.Integer(), nullable=True),
        sa.Column("model_provider", sa.String(32), nullable=True),
        sa.Column("model", sa.String(200), nullable=True),
        sa.Column("requested_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_table(
        "speaker_insight_items",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("run_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("speaker_insights.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("speaker_label", sa.String(32), nullable=False),
        sa.Column("interrupted_label", sa.String(32), nullable=True),
        sa.Column("start_time", sa.Numeric(10, 2), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
    )
    op.create_index("ix_speaker_insight_items_run_id", "speaker_insight_items", ["run_id"])


def downgrade() -> None:
    op.drop_table("speaker_insight_items")
    op.drop_table("speaker_insights")
