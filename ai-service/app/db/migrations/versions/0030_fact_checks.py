"""fact_checks and claims (事實查核): checkable claims marked in a job, and each one's verdict once checked

Revision ID: 0030
Revises: 0029
Create Date: 2026-10-04
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0030"
down_revision = "0029"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "fact_checks",
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
        "claims",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("job_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("speaker_label", sa.String(32), nullable=True),
        sa.Column("start_time", sa.Numeric(10, 2), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("claim", sa.Text(), nullable=False),
        sa.Column("kind", sa.String(8), nullable=False),
        sa.Column("verdict", sa.String(24), nullable=True),
        sa.Column("explanation", sa.Text(), nullable=True),
        sa.Column("sources", postgresql.JSONB(), nullable=False, server_default="[]"),
        sa.Column("checked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("check_model_provider", sa.String(32), nullable=True),
        sa.Column("check_model", sa.String(200), nullable=True),
        sa.Column("checking_since", sa.DateTime(timezone=True), nullable=True),
        sa.Column("check_error", sa.Text(), nullable=True),
        sa.Column("source_revision", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_claims_job_id", "claims", ["job_id"])


def downgrade() -> None:
    op.drop_table("claims")
    op.drop_table("fact_checks")
