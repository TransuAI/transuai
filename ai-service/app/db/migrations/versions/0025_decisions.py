"""decisions (決策紀錄): decisions made in a meeting, and each job's extraction

Revision ID: 0025
Revises: 0024
Create Date: 2026-10-04
"""
from alembic import op
import sqlalchemy as sa
from pgvector.sqlalchemy import Vector
from sqlalchemy.dialects import postgresql

revision = "0025"
down_revision = "0024"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "decision_extractions",
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
        "decisions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("job_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("statement", sa.Text(), nullable=False),
        sa.Column("rationale", sa.Text(), nullable=False, server_default=""),
        sa.Column("alternatives", postgresql.JSONB(), nullable=False, server_default="[]"),
        sa.Column("proposed_by", sa.String(32), nullable=True),
        sa.Column("tentative", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("start_time", sa.Numeric(10, 2), nullable=True),
        sa.Column("evidence_text", sa.Text(), nullable=True),
        sa.Column("source", sa.String(8), nullable=False, server_default="ai"),
        sa.Column("edited", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("supersedes_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("decisions.id", ondelete="SET NULL"), nullable=True),
        sa.Column("embedding", Vector(1024), nullable=True),
        sa.Column("source_revision", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_decisions_job_id", "decisions", ["job_id"])
    op.create_index("ix_decisions_user_id", "decisions", ["user_id"])


def downgrade() -> None:
    op.drop_table("decisions")
    op.drop_table("decision_extractions")
