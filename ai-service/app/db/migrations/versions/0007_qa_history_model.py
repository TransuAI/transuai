"""qa history model: which model answered each question

Revision ID: 0007
Revises: 0006
Create Date: 2026-09-26
"""
from alembic import op
import sqlalchemy as sa

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Answers from before this don't know their model: left empty.
    op.add_column("qa_history", sa.Column("model_provider", sa.String(32), nullable=True))
    op.add_column("qa_history", sa.Column("model", sa.String(200), nullable=True))


def downgrade() -> None:
    op.drop_column("qa_history", "model")
    op.drop_column("qa_history", "model_provider")
