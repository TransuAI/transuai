import os
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import grpc
import pytest
from sqlalchemy import create_engine, text

# Tests that touch the database (the gRPC servicer tests) use their own database on the dev
# Postgres from infra's docker compose — never the real transcription_db. Environment variables
# win over .env in pydantic-settings, and app.core.config reads them at import time, so this has
# to be set before anything under app/ is imported.
TEST_DB_NAME = "transcription_test_db"
os.environ["DB_NAME"] = TEST_DB_NAME

from app.controllers.transcript_controller import TranscriptController  # noqa: E402
from app.core.config import settings  # noqa: E402
from app.db import engine, init_db, new_session  # noqa: E402
from app.proto_gen import transcription_pb2_grpc  # noqa: E402

from app.services import pipeline
from app.services.transcriber import TranscriptResult


@pytest.fixture
def mocks():
    """驅動 `process_message()` 這個 seam 的共用 mocking boundary：pipeline 會碰到的外部 I/O（Groq、下載、
    抽音軌、gRPC 狀態回報、DB session / 存檔）全部 patch 在 pipeline 模組「使用端」import 進來的名稱
    （跟 ai-service/tests/test_pipeline_retry.py 同一種做法），並預先設好 happy-path 的回傳值。"""
    with (
        patch.object(pipeline, "job_status_client") as job_status_client,
        patch.object(pipeline, "download_object", return_value=Path("/tmp/fake-download.mp3")) as download_object,
        patch.object(pipeline, "extract_audio_track") as extract_audio_track,
        patch.object(pipeline, "transcribe") as transcribe,
        patch.object(pipeline, "new_session", return_value=MagicMock(name="session")),
        patch.object(pipeline, "save_transcript") as save_transcript,
        patch("pathlib.Path.unlink"),
    ):
        transcribe.return_value = TranscriptResult(language="English", full_text="", segments=[])
        yield SimpleNamespace(
            job_status_client=job_status_client,
            download_object=download_object,
            extract_audio_track=extract_audio_track,
            transcribe=transcribe,
            save_transcript=save_transcript,
        )


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
        conn.execute(text("TRUNCATE transcripts, transcript_segments CASCADE"))


@pytest.fixture(scope="session")
def transcription_stub(test_database):
    """The real TranscriptionService, served in-process on a free port."""
    from concurrent import futures

    server = grpc.server(futures.ThreadPoolExecutor(max_workers=4))
    transcription_pb2_grpc.add_TranscriptionServiceServicer_to_server(TranscriptController(), server)
    port = server.add_insecure_port("localhost:0")
    server.start()
    channel = grpc.insecure_channel(f"localhost:{port}")
    yield transcription_pb2_grpc.TranscriptionServiceStub(channel)
    channel.close()
    server.stop(grace=None)
