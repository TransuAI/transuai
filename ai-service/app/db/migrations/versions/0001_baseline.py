"""baseline: the schema as SQLAlchemy create_all built it before migrations existed

Revision ID: 0001
Revises:
Create Date: 2026-09-26

create_all only ever grew ai_db by whole tables (summaries first, chapters / embeddings /
qa_history later) and never altered one, so a database from before migrations can hold any subset
of these tables, each already in its final baseline shape. This revision therefore creates only the
tables that are missing: on an empty database it builds the whole schema, on a pre-migration one it
fills the gaps and leaves existing tables (and their rows) alone — no separate "stamp" step needed.

The one column create_all did leave behind is embeddings.embedding, which was vector(768) before
the switch to BAAI/bge-m3 (1024 dimensions); such a table can't be adopted and stops the upgrade.
"""
from alembic import op
import sqlalchemy as sa
from pgvector.sqlalchemy import Vector
from sqlalchemy.dialects import postgresql

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def _create_table_with_job_index(name: str, *columns: sa.Column, unique_job_id: bool = False) -> None:
    op.create_table(name, *columns)
    op.create_index(f"ix_{name}_job_id", name, ["job_id"], unique=unique_job_id)


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    existing = set(sa.inspect(op.get_bind()).get_table_names())

    if "summaries" not in existing:
        _create_table_with_job_index(
            "summaries",
            sa.Column("id", sa.UUID(), primary_key=True),
            sa.Column("job_id", sa.UUID(), nullable=False),
            sa.Column("summary_text", sa.Text()),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            unique_job_id=True,
        )
    if "chapters" not in existing:
        _create_table_with_job_index(
            "chapters",
            sa.Column("id", sa.UUID(), primary_key=True),
            sa.Column("job_id", sa.UUID(), nullable=False),
            sa.Column("title", sa.String(200), nullable=False),
            sa.Column("start_time", sa.Numeric(10, 2), nullable=False),
            sa.Column("sequence_no", sa.Integer(), nullable=False),
        )
    if "embeddings" in existing:
        vector_type = op.get_bind().scalar(sa.text(
            "SELECT format_type(atttypid, atttypmod) FROM pg_attribute "
            "WHERE attrelid = 'embeddings'::regclass AND attname = 'embedding'"))
        if vector_type != "vector(1024)":
            raise RuntimeError(
                f"embeddings.embedding is {vector_type}, not vector(1024) (it predates the switch to "
                "BAAI/bge-m3): drop the embeddings table and re-run the affected jobs' pipeline")
    else:
        _create_table_with_job_index(
            "embeddings",
            sa.Column("id", sa.UUID(), primary_key=True),
            sa.Column("job_id", sa.UUID(), nullable=False),
            sa.Column("chunk_text", sa.Text(), nullable=False),
            sa.Column("start_time", sa.Numeric(10, 2)),
            sa.Column("end_time", sa.Numeric(10, 2)),
            sa.Column("embedding", Vector(1024), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
        )
    if "qa_history" not in existing:
        _create_table_with_job_index(
            "qa_history",
            sa.Column("id", sa.UUID(), primary_key=True),
            sa.Column("job_id", sa.UUID(), nullable=False),
            sa.Column("user_id", sa.UUID(), nullable=False),
            sa.Column("question", sa.Text(), nullable=False),
            sa.Column("answer", sa.Text(), nullable=False),
            sa.Column("source_timestamps", postgresql.ARRAY(sa.Numeric(10, 2)), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
        )


def downgrade() -> None:
    for name in ("qa_history", "embeddings", "chapters", "summaries"):
        op.drop_table(name)
