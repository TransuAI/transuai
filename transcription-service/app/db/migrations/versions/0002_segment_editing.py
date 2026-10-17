"""segment editing: original text per segment, revision per transcript

Revision ID: 0002
Revises: 0001
Create Date: 2026-09-26
"""
from alembic import op
import sqlalchemy as sa

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("transcripts", sa.Column("revision", sa.Integer(), nullable=False, server_default="0"))
    # Nothing has been edited yet, so every existing segment's original text is its current text.
    op.add_column("transcript_segments", sa.Column("original_text", sa.Text(), nullable=True))
    op.execute("UPDATE transcript_segments SET original_text = text")
    op.alter_column("transcript_segments", "original_text", nullable=False)


def downgrade() -> None:
    op.drop_column("transcript_segments", "original_text")
    op.drop_column("transcripts", "revision")
