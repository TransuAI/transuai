"""llm_usage.job_id may be empty: a call that belongs to no single job (asking about decisions across jobs)

Revision ID: 0028
Revises: 0027
Create Date: 2026-10-04
"""
from alembic import op

revision = "0028"
down_revision = "0027"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column("llm_usage", "job_id", nullable=True)


def downgrade() -> None:
    op.execute("DELETE FROM llm_usage WHERE job_id IS NULL")
    op.alter_column("llm_usage", "job_id", nullable=False)
