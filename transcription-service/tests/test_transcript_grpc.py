import uuid

import grpc
import pytest
from sqlalchemy import inspect, text

from app.proto_gen import transcription_pb2
from app.repositories.transcript_repository import save_transcript
from app.services.transcriber import TranscriptResult, TranscriptSegment


def test_get_transcript_returns_a_saved_transcript(transcription_stub, db_session):
    job_id = uuid.uuid4()
    save_transcript(db_session, job_id, TranscriptResult(
        language="Chinese",
        full_text="大家好 今天來聊預算",
        segments=[TranscriptSegment(0.0, 1.5, "大家好"), TranscriptSegment(1.5, 3.25, "今天來聊預算")],
    ))

    transcript = transcription_stub.GetTranscript(transcription_pb2.GetTranscriptRequest(job_id=str(job_id)))

    assert transcript.job_id == str(job_id)
    assert transcript.language == "Chinese"
    assert transcript.full_text == "大家好 今天來聊預算"
    assert [(s.start_time, s.end_time, s.text) for s in transcript.segments] == [
        (0.0, 1.5, "大家好"),
        (1.5, 3.25, "今天來聊預算"),
    ]


def test_get_transcript_for_an_unknown_job_is_not_found(transcription_stub):
    with pytest.raises(grpc.RpcError) as error:
        transcription_stub.GetTranscript(transcription_pb2.GetTranscriptRequest(job_id=str(uuid.uuid4())))

    assert error.value.code() == grpc.StatusCode.NOT_FOUND


def test_get_transcript_with_a_malformed_job_id_is_invalid(transcription_stub):
    with pytest.raises(grpc.RpcError) as error:
        transcription_stub.GetTranscript(transcription_pb2.GetTranscriptRequest(job_id="not-a-uuid"))

    assert error.value.code() == grpc.StatusCode.INVALID_ARGUMENT


def test_startup_brings_the_schema_under_versioned_migrations(test_database):
    with test_database.connect() as conn:
        versions = conn.execute(text("SELECT version_num FROM alembic_version")).scalars().all()

    assert len(versions) == 1


# The DDL SQLAlchemy create_all issued before migrations existed (frozen here on purpose: the
# models keep changing, a database from back then doesn't).
PRE_MIGRATION_SCHEMA = """
CREATE TABLE transcripts (
    id UUID PRIMARY KEY, job_id UUID NOT NULL, language VARCHAR(10), full_text TEXT,
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL);
CREATE INDEX ix_transcripts_job_id ON transcripts (job_id);
CREATE TABLE transcript_segments (
    id UUID PRIMARY KEY,
    transcript_id UUID NOT NULL REFERENCES transcripts (id) ON DELETE CASCADE,
    start_time NUMERIC(10, 2) NOT NULL, end_time NUMERIC(10, 2) NOT NULL, speaker_label VARCHAR(50),
    text TEXT NOT NULL, sequence_no INTEGER NOT NULL);
"""


def test_startup_adopts_a_database_created_before_migrations_existed(empty_schema):
    """Existing dev databases were built by SQLAlchemy create_all; startup must take them over
    as the baseline, then apply the later migrations, keeping their rows."""
    from app.db import init_db

    transcript_id, job_id = uuid.uuid4(), uuid.uuid4()
    with empty_schema.begin() as conn:
        conn.execute(text(PRE_MIGRATION_SCHEMA))
        conn.execute(text("INSERT INTO transcripts VALUES (:id, :job, 'Chinese', '大家好', now())"),
                     {"id": transcript_id, "job": job_id})
        conn.execute(text("INSERT INTO transcript_segments VALUES (:id, :t, 0, 1.5, NULL, '大家好', 0)"),
                     {"id": uuid.uuid4(), "t": transcript_id})

    init_db()

    with empty_schema.connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM alembic_version")).scalar() == 1
        assert conn.execute(text("SELECT revision FROM transcripts")).scalar() == 0
        # Nothing was edited before, so the original text is the current text.
        assert conn.execute(text("SELECT original_text FROM transcript_segments")).scalar() == "大家好"


def test_startup_refuses_a_database_with_only_part_of_the_baseline_tables(empty_schema):
    from app.db import init_db

    with empty_schema.begin() as conn:  # transcripts without transcript_segments
        conn.execute(text(PRE_MIGRATION_SCHEMA.split("CREATE TABLE transcript_segments")[0]))

    with pytest.raises(RuntimeError, match="transcript_segments"):
        init_db()
