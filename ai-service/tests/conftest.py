import os

import pytest
from sqlalchemy import create_engine, text

# Tests that touch the database use their own database on the dev Postgres from infra's docker
# compose — never the real ai_db. Environment variables win over .env in pydantic-settings, and
# app.core.config reads them at import time, so this has to be set before anything under app/ is
# imported.
TEST_DB_NAME = "ai_test_db"
os.environ["DB_NAME"] = TEST_DB_NAME

from app.core.config import settings  # noqa: E402
from app.db import engine, init_db, new_session  # noqa: E402


def _reset_schema():
    # Guard: this drops everything, so make sure it can only ever hit the test database.
    assert settings.db_name == TEST_DB_NAME, f"refusing to reset {settings.db_name!r}"
    with engine.begin() as conn:
        conn.execute(text("DROP SCHEMA public CASCADE"))
        conn.execute(text("CREATE SCHEMA public"))


@pytest.fixture(scope="session")
def test_database():
    """A clean test database, (re)created per test session, with the schema set up the same way
    the service does it at startup (init_db)."""
    admin = create_engine(settings.database_url.rsplit("/", 1)[0] + "/postgres", isolation_level="AUTOCOMMIT")
    with admin.connect() as conn:
        if not conn.scalar(text("SELECT 1 FROM pg_database WHERE datname = :name"), {"name": TEST_DB_NAME}):
            conn.execute(text(f'CREATE DATABASE "{TEST_DB_NAME}"'))
    admin.dispose()

    _reset_schema()
    init_db()
    yield engine
    engine.dispose()


@pytest.fixture
def empty_schema(test_database):
    """An empty public schema for tests about how startup handles existing databases; the
    migrated schema is restored afterwards for the other tests."""
    _reset_schema()
    yield test_database
    _reset_schema()
    init_db()


@pytest.fixture
def db_session(test_database):
    """A session on the test database; tables are emptied after each test."""
    session = new_session()
    yield session
    session.close()
    with test_database.begin() as conn:
        conn.execute(text("TRUNCATE summaries, chapters, embeddings, qa_history"))


@pytest.fixture(scope="session")
def ai_stub(test_database):
    """The real AiService, served in-process on a free port."""
    from concurrent import futures

    import grpc

    from app.controllers.ai_controller import AiController
    from app.proto_gen import ai_pb2_grpc

    server = grpc.server(futures.ThreadPoolExecutor(max_workers=4))
    ai_pb2_grpc.add_AiServiceServicer_to_server(AiController(), server)
    port = server.add_insecure_port("localhost:0")
    server.start()
    channel = grpc.insecure_channel(f"localhost:{port}")
    yield ai_pb2_grpc.AiServiceStub(channel)
    channel.close()
    server.stop(grace=None)
