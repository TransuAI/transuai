"""speakers: the speakers found in each transcript when it is transcribed

Revision ID: 0003
Revises: 0002
Create Date: 2026-09-26
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Transcripts from before speakers were recognised get no speakers: their segments keep a NULL speaker_label.
    op.create_table(
        "speakers",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("transcript_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("transcripts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("label", sa.String(50), nullable=False),
        sa.Column("display_order", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(100), nullable=True),
        sa.UniqueConstraint("transcript_id", "label"),
    )


def downgrade() -> None:
    op.drop_table("speakers")
