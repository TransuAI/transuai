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


def test_startup_adopts_a_database_created_before_migrations_existed(empty_schema):
    """Existing dev databases were built by SQLAlchemy create_all; startup must take them over
    as the baseline instead of failing on tables that already exist."""
    from app.db import init_db
    from app.models import Base

    Base.metadata.create_all(bind=empty_schema)  # how the schema was created before Alembic

    init_db()

    with empty_schema.connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM alembic_version")).scalar() == 1
    assert {"transcripts", "transcript_segments"} <= set(inspect(empty_schema).get_table_names())


def test_startup_refuses_a_database_with_only_part_of_the_baseline_tables(empty_schema):
    from app.db import init_db
    from app.models import Base

    Base.metadata.tables["transcripts"].create(bind=empty_schema)  # transcripts without transcript_segments

    with pytest.raises(RuntimeError, match="transcript_segments"):
        init_db()
