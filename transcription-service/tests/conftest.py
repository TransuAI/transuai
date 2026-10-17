import atexit
import json
import os
import uuid
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import grpc
import pytest
from sqlalchemy import text
from testcontainers.community.postgres import PostgresContainer
from testcontainers.community.redis import RedisContainer

# Tests that touch the database (the gRPC servicer tests) and the transcript cache get a throwaway
# Postgres and Redis that testcontainers starts for this test run and removes afterwards — never the
# real transcription_db, and nothing to start by hand (Docker has to be running). Environment
# variables win over .env in pydantic-settings, and app.core.config reads them at import time, so
# this has to happen before anything under app/ is imported.
TEST_DB_NAME = "transcription_test_db"
_postgres = PostgresContainer("pgvector/pgvector:pg16", username="test", password="test", dbname=TEST_DB_NAME)
_postgres.start()
atexit.register(_postgres.stop)
_redis = RedisContainer("redis:7-alpine")
_redis.start()
atexit.register(_redis.stop)
os.environ |= {
    "DB_HOST": _postgres.get_container_host_ip(),
    "DB_PORT": str(_postgres.get_exposed_port(5432)),
    "DB_USER": "test",
    "DB_PASSWORD": "test",
    "DB_NAME": TEST_DB_NAME,
    "REDIS_HOST": _redis.get_container_host_ip(),
    "REDIS_PORT": str(_redis.get_exposed_port(6379)),
    # A fixed master key for keys saved on the system settings page: 32 bytes, base64.
    "KEY_ENCRYPTION_KEY": "dGVzdC1tYXN0ZXIta2V5LWZvci1hZXMtZ2NtLTMyYiE=",
}

from app.controllers.transcript_controller import TranscriptController  # noqa: E402
from app.core.config import settings  # noqa: E402
from app.db import engine, init_db, new_session  # noqa: E402
from app.proto_gen import transcription_pb2_grpc  # noqa: E402

from app.services import pipeline, recording_limits, transcription_usage
from app.services.speech_recognition import Recognition
from app.services.transcript_result import TranscriptResult


@pytest.fixture
def mocks():
    """驅動 `process_message()` 這個 seam 的共用 mocking boundary：pipeline 會碰到的外部 I/O（語音辨識、下載、用量存檔、
    抽音軌、gRPC 狀態回報、DB session / 存檔）全部 patch 在 pipeline 模組「使用端」import 進來的名稱
    （跟 ai-service/tests/test_pipeline_retry.py 同一種做法），並預先設好 happy-path 的回傳值。"""
    with (
        patch.object(pipeline, "job_status_client") as job_status_client,
        patch.object(pipeline, "download_object", return_value=Path("/tmp/fake-download.mp3")) as download_object,
        patch.object(pipeline, "extract_audio_track") as extract_audio_track,
        patch.object(pipeline, "media_duration_seconds", return_value=60.0) as media_duration_seconds,
        patch.object(recording_limits, "_used_this_month", return_value=0.0) as used_this_month,
        patch.object(pipeline, "recognize") as recognize,
        patch.object(pipeline, "new_session", return_value=MagicMock(name="session")),
        patch.object(pipeline, "save_transcript") as save_transcript,
        patch.object(pipeline.job_deletion, "discard_if_deleted", return_value=False) as discard_if_deleted,
        patch.object(transcription_usage, "save_transcription_usage"),
        patch("pathlib.Path.unlink"),
    ):
        recognize.return_value = Recognition(language="en", words=[])
        yield SimpleNamespace(
            job_status_client=job_status_client,
            download_object=download_object,
            extract_audio_track=extract_audio_track,
            media_duration_seconds=media_duration_seconds,
            used_this_month=used_this_month,
            recognize=recognize,
            save_transcript=save_transcript,
            discard_if_deleted=discard_if_deleted,
        )


@pytest.fixture
def run_pipeline(mocks):
    """讓語音辨識回傳指定的逐字資料、跑一次 process_message()，回傳實際交給存檔的逐字稿。"""

    def _run(recognition: Recognition) -> TranscriptResult:
        mocks.recognize.return_value = recognition
        body = json.dumps(
            {"jobId": str(uuid.uuid4()), "storagePath": "uploads/foo.mp3", "fileType": "AUDIO"}).encode("utf-8")
        pipeline.process_message(body, MagicMock(), MagicMock())
        mocks.save_transcript.assert_called_once()
        return mocks.save_transcript.call_args.args[2]

    return _run


@pytest.fixture
def rabbitmq():
    """The RabbitMQ boundary: every connection the service opens to publish events is a fake whose
    channel records what was published."""
    with patch("app.services.edit_events.BlockingConnection") as connection_class:
        channel = MagicMock(name="channel")
        connection_class.return_value.channel.return_value = channel
        yield FakeRabbitMQ(connection_class, channel)


class FakeRabbitMQ:
    def __init__(self, connection_class, channel):
        self.connection_class = connection_class
        self.channel = channel

    def published(self):
        return [
            (call.kwargs["routing_key"], json.loads(call.kwargs["body"]))
            for call in self.channel.basic_publish.call_args_list
        ]


def _reset_schema():
    # Guard: this drops everything, so make sure it can only ever hit the test database.
    assert settings.db_name == TEST_DB_NAME, f"refusing to reset {settings.db_name!r}"
    with engine.begin() as conn:
        conn.execute(text("DROP SCHEMA public CASCADE"))
        conn.execute(text("CREATE SCHEMA public"))


@pytest.fixture(scope="session")
def test_database():
    """A clean test database with the schema set up the same way the service does it at startup
    (init_db)."""
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


@pytest.fixture(autouse=True)
def fresh_speech_settings():
    """Settings saved on the system settings page are cached for a few seconds: no test sees another's."""
    from app.services import speech_settings

    speech_settings._forget()
    yield
    speech_settings._forget()


@pytest.fixture
def db_session(test_database):
    """A session on the test database; tables are emptied after each test."""
    session = new_session()
    yield session
    session.close()
    with test_database.begin() as conn:
        conn.execute(text("TRUNCATE transcripts, transcript_segments, speakers, transcription_usage, deleted_jobs, speech_settings CASCADE"))


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


@pytest.fixture
def redis_client():
    """A client on the test Redis (the transcript cache)."""
    return _redis.get_client()


@pytest.fixture(autouse=True)
def empty_cache():
    """Every test starts with an empty transcript cache."""
    _redis.get_client().flushall()
