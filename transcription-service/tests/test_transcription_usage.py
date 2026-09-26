"""轉錄用量（見 CONTEXT.md「轉錄用量」）：每次呼叫語音辨識服務都在 Job 擁有者名下記一筆音檔秒數。pipeline 的測試
攔下存檔的內容；gRPC 的測試真的寫進測試資料庫。"""

import json
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import grpc
import httpx
import pytest

from app.proto_gen import transcription_pb2
from app.repositories.transcription_usage_repository import TranscriptionUsageRecord, save_transcription_usage
from app.services import pipeline, transcription_usage
from app.services.retry import RetryableMessageError
from app.services.speech_recognition import Recognition, RecognizedWord

OWNER = uuid.UUID("00000000-0000-0000-0000-0000000000a1")


@pytest.fixture
def saved_usage():
    records: list[TranscriptionUsageRecord] = []
    with patch.object(transcription_usage, "save_transcription_usage", side_effect=records.append):
        yield records


def run(mocks, *, user_id: uuid.UUID | None = OWNER, retry_count: int = 0) -> uuid.UUID:
    job_id = uuid.uuid4()
    payload = {"jobId": str(job_id), "storagePath": "uploads/a.mp3", "fileType": "AUDIO"}
    if user_id:
        payload["userId"] = str(user_id)
    pipeline.process_message(json.dumps(payload).encode(), MagicMock(), MagicMock(), retry_count=retry_count)
    return job_id


def test_a_transcription_records_the_seconds_of_audio_under_the_jobs_owner(mocks, saved_usage):
    mocks.recognize.return_value = Recognition(
        language="zh-TW", words=[RecognizedWord(0.0, 1.0, "你好", "0")], audio_seconds=1834.5)

    job_id = run(mocks)

    [record] = saved_usage
    assert (record.user_id, record.job_id, record.provider, record.model, record.audio_seconds, record.succeeded) == (
        OWNER, job_id, "deepgram", "nova-3", 1834.5, True)


def test_a_failed_transcription_is_recorded_without_seconds(mocks, saved_usage):
    request = httpx.Request("POST", "https://api.deepgram.com/v1/listen")
    mocks.recognize.side_effect = httpx.HTTPStatusError("bad audio", request=request, response=httpx.Response(400, request=request))

    run(mocks)

    [record] = saved_usage
    assert (record.succeeded, record.audio_seconds) == (False, None)


def test_each_attempt_is_recorded_even_the_ones_that_will_be_retried(mocks, saved_usage):
    request = httpx.Request("POST", "https://api.deepgram.com/v1/listen")
    mocks.recognize.side_effect = [
        httpx.HTTPStatusError("busy", request=request, response=httpx.Response(503, request=request)),
        Recognition(language="zh-TW", words=[], audio_seconds=60.0),
    ]

    with pytest.raises(RetryableMessageError):
        run(mocks, retry_count=0)
    run(mocks, retry_count=1)  # the retried delivery

    assert [(record.succeeded, record.audio_seconds) for record in saved_usage] == [(False, None), (True, 60.0)]


def test_a_malformed_owner_is_treated_as_unknown(mocks, saved_usage):
    job_id = uuid.uuid4()
    body = json.dumps({"jobId": str(job_id), "userId": "not-a-uuid", "storagePath": "uploads/a.mp3", "fileType": "AUDIO"})
    publish_completed = MagicMock()

    pipeline.process_message(body.encode(), publish_completed, MagicMock())

    assert saved_usage[0].user_id is None
    publish_completed.assert_called_once_with(str(job_id), None)


def test_a_message_without_an_owner_records_usage_without_a_user(mocks, saved_usage):
    run(mocks, user_id=None)

    assert saved_usage[0].user_id is None


def test_a_usage_record_that_cannot_be_saved_does_not_fail_the_job(mocks):
    with patch.object(transcription_usage, "save_transcription_usage", side_effect=RuntimeError("database down")):
        job_id = run(mocks)

    mocks.job_status_client.update_status.assert_any_call(str(job_id), "TRANSCRIBED")


# --- 查詢（真的 Postgres）---


def record(job_id, seconds, *, minute, succeeded=True):
    return TranscriptionUsageRecord(
        user_id=OWNER, job_id=job_id, provider="deepgram", model="nova-3", audio_seconds=seconds,
        succeeded=succeeded, created_at=datetime(2026, 9, 26, 10, minute, tzinfo=timezone.utc))


def test_a_jobs_transcription_usage_is_listed_oldest_first(transcription_stub, db_session):
    job_id = uuid.uuid4()
    save_transcription_usage(record(job_id, 90.5, minute=2))
    save_transcription_usage(record(job_id, None, minute=1, succeeded=False))
    save_transcription_usage(record(uuid.uuid4(), 10.0, minute=1))

    response = transcription_stub.ListJobTranscriptionUsage(
        transcription_pb2.ListJobTranscriptionUsageRequest(job_id=str(job_id)))

    assert [(r.HasField("audio_seconds"), r.succeeded) for r in response.records] == [(False, False), (True, True)]
    assert (response.records[1].provider, response.records[1].model, response.records[1].audio_seconds) == (
        "deepgram", "nova-3", 90.5)


def test_listing_transcription_usage_with_a_malformed_job_id_is_invalid(transcription_stub):
    with pytest.raises(grpc.RpcError) as error:
        transcription_stub.ListJobTranscriptionUsage(transcription_pb2.ListJobTranscriptionUsageRequest(job_id="nope"))

    assert error.value.code() == grpc.StatusCode.INVALID_ARGUMENT


# --- 一位使用者一段時間的彙總（真的 Postgres）---

SEPTEMBER = (datetime(2026, 8, 31, 16, tzinfo=timezone.utc), datetime(2026, 9, 30, 16, tzinfo=timezone.utc))


def transcribed(at, model, seconds, *, user_id=OWNER, succeeded=True):
    return TranscriptionUsageRecord(
        user_id=user_id, job_id=uuid.uuid4(), provider="deepgram", model=model, audio_seconds=seconds,
        succeeded=succeeded, created_at=at)


def sum_usage(stub, user_id: uuid.UUID | str = OWNER, start=SEPTEMBER[0], end=SEPTEMBER[1]):
    request = transcription_pb2.SumUserTranscriptionUsageRequest(user_id=str(user_id))
    request.start.FromDatetime(start)
    request.end.FromDatetime(end)
    return stub.SumUserTranscriptionUsage(request).sums


def test_a_users_transcription_over_a_period_is_summed_per_model(transcription_stub, db_session):
    start, _ = SEPTEMBER
    save_transcription_usage(transcribed(start, "nova-3", 90.5))
    save_transcription_usage(transcribed(start + timedelta(days=2), "nova-3", 29.5))
    save_transcription_usage(transcribed(start + timedelta(days=3), "nova-3", None, succeeded=False))
    save_transcription_usage(transcribed(start + timedelta(days=4), "nova-2", 60.0))

    sums = sum_usage(transcription_stub)

    assert [(s.provider, s.model, s.audio_seconds, s.calls, s.calls_with_unknown_usage) for s in sums] == [
        ("deepgram", "nova-2", 60.0, 1, 0), ("deepgram", "nova-3", 120.0, 3, 1)]


def test_the_sum_leaves_out_other_users_and_transcriptions_outside_the_period(transcription_stub, db_session):
    start, end = SEPTEMBER
    save_transcription_usage(transcribed(start - timedelta(seconds=1), "nova-3", 1.0))
    save_transcription_usage(transcribed(end, "nova-3", 2.0))
    save_transcription_usage(transcribed(start, "nova-3", 4.0, user_id=uuid.uuid4()))
    save_transcription_usage(transcribed(end - timedelta(seconds=1), "nova-3", 8.0))

    assert [(s.audio_seconds, s.calls) for s in sum_usage(transcription_stub)] == [(8.0, 1)]


def test_summing_transcription_usage_needs_a_valid_user_and_a_period(transcription_stub):
    with pytest.raises(grpc.RpcError) as error:
        sum_usage(transcription_stub, user_id="nope")
    assert error.value.code() == grpc.StatusCode.INVALID_ARGUMENT

    with pytest.raises(grpc.RpcError) as error:
        transcription_stub.SumUserTranscriptionUsage(
            transcription_pb2.SumUserTranscriptionUsageRequest(user_id=str(OWNER)))
    assert error.value.code() == grpc.StatusCode.INVALID_ARGUMENT
