import uuid

import pytest
from sqlalchemy import inspect, text

from app.db import init_db
from app.models import Base

ALL_TABLES = {"summaries", "chapters", "embeddings", "qa_history"}


def test_startup_builds_the_whole_schema_under_versioned_migrations(test_database):
    assert ALL_TABLES <= set(inspect(test_database).get_table_names())
    with test_database.connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM alembic_version")).scalar() == 1


def test_startup_completes_a_database_created_before_migrations_existed(empty_schema):
    """ai-service's create_all schema only ever grew by whole tables, so a pre-migration database
    can hold any subset of them (a dev ai_db from before chapters/Q&A only has summaries). Startup
    has to add the missing tables and keep the existing ones and their rows."""
    Base.metadata.tables["summaries"].create(bind=empty_schema)
    job_id = uuid.uuid4()
    with empty_schema.begin() as conn:
        conn.execute(
            text("INSERT INTO summaries (id, job_id, summary_text, created_at) VALUES (:id, :job, '舊摘要', now())"),
            {"id": uuid.uuid4(), "job": job_id},
        )

    init_db()

    assert ALL_TABLES <= set(inspect(empty_schema).get_table_names())
    with empty_schema.connect() as conn:
        assert conn.execute(text("SELECT summary_text FROM summaries WHERE job_id = :job"), {"job": job_id}).scalar() == "舊摘要"
        assert conn.execute(text("SELECT count(*) FROM alembic_version")).scalar() == 1


def test_startup_refuses_a_pre_migration_embeddings_table_with_the_old_vector_size(empty_schema):
    """Embeddings once had 768 dimensions (before bge-m3); create_all never altered that column, so
    such a table isn't in the baseline's shape and can't just be adopted."""

    with empty_schema.begin() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        conn.execute(text(
            "CREATE TABLE embeddings (id uuid PRIMARY KEY, job_id uuid NOT NULL, chunk_text text NOT NULL, "
            "start_time numeric(10,2), end_time numeric(10,2), embedding vector(768) NOT NULL, "
            "created_at timestamp NOT NULL)"))

    with pytest.raises(RuntimeError, match="vector\\(768\\)"):
        init_db()
