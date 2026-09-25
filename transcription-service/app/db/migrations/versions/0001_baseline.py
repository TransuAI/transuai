"""baseline: the schema as SQLAlchemy create_all built it before migrations existed

Revision ID: 0001
Revises:
Create Date: 2026-09-26
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "transcripts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("job_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("language", sa.String(10)),
        sa.Column("full_text", sa.Text()),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_transcripts_job_id", "transcripts", ["job_id"])
    op.create_table(
        "transcript_segments",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "transcript_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("transcripts.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("start_time", sa.Numeric(10, 2), nullable=False),
        sa.Column("end_time", sa.Numeric(10, 2), nullable=False),
        sa.Column("speaker_label", sa.String(50)),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("sequence_no", sa.Integer(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("transcript_segments")
    op.drop_index("ix_transcripts_job_id", table_name="transcripts")
    op.drop_table("transcripts")
