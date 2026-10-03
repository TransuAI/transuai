"""Job 在 upload-service 刪掉之後（`job.deleted`）清掉這個服務的逐字稿與快取；刪除時還在跑的寫入晚到也不留資料
（見 .scratch/account-deletion/issues/01）。"""

import json
import uuid
from unittest.mock import MagicMock

import pytest
from sqlalchemy import func, select

from app.models.transcript import Speaker, Transcript, TranscriptionUsage, TranscriptSegment
from app.proto_gen import transcription_pb2
from app.repositories.transcript_repository import save_transcript
from app.repositories.transcription_usage_repository import TranscriptionUsageRecord, save_transcription_usage
from app.services import deletion_consumer, job_deletion, pipeline, transcript_cache
from app.services.transcript_result import TranscriptResult, TranscriptSegment as ResultSegment


def save(session, job_id: uuid.UUID) -> None:
    save_transcript(session, job_id, TranscriptResult(
        language="Chinese", full_text="大家好 今天來聊預算",
        segments=[ResultSegment(0.0, 1.5, "大家好", speaker_label="1"), ResultSegment(1.5, 3.0, "今天來聊預算", speaker_label="2")],
        speaker_labels=["1", "2"],
    ))


def count(session, model, job_id: uuid.UUID) -> int:
    if model is Transcript or model is TranscriptionUsage:
        return session.scalar(select(func.count()).select_from(model).where(model.job_id == job_id))
    return session.scalar(select(func.count()).select_from(model).join(Transcript).where(Transcript.job_id == job_id))


@pytest.fixture
def two_jobs(db_session):
    deleted, kept = uuid.uuid4(), uuid.uuid4()
    for job_id in (deleted, kept):
        save(db_session, job_id)
        save_transcription_usage(TranscriptionUsageRecord(
            user_id=uuid.uuid4(), job_id=job_id, provider="deepgram", model="nova-3", audio_seconds=60.0, succeeded=True))
    return deleted, kept


def test_the_deleted_jobs_transcript_segments_and_speakers_are_removed_and_other_jobs_are_not(db_session, two_jobs):
    deleted, kept = two_jobs

    job_deletion.delete_job_data(deleted)

    db_session.expire_all()
    for model in (Transcript, TranscriptSegment, Speaker):
        assert count(db_session, model, deleted) == 0
        assert count(db_session, model, kept) > 0


def test_transcription_usage_is_kept(db_session, two_jobs):
    deleted, _ = two_jobs

    job_deletion.delete_job_data(deleted)

    assert count(db_session, TranscriptionUsage, deleted) == 1


def test_handling_the_same_event_twice_is_fine(db_session, two_jobs):
    deleted, _ = two_jobs

    job_deletion.delete_job_data(deleted)
    job_deletion.delete_job_data(deleted)

    assert count(db_session, Transcript, deleted) == 0


def test_the_cached_transcript_is_dropped_and_a_late_write_back_cannot_bring_it_back(db_session, two_jobs):
    deleted, _ = two_jobs
    transcript_cache.remember(deleted, transcription_pb2.Transcript(job_id=str(deleted), revision=0))

    job_deletion.delete_job_data(deleted)
    # 刪除之前就開始的讀取，晚一步寫回
    transcript_cache.remember(deleted, transcription_pb2.Transcript(job_id=str(deleted), revision=0))

    assert transcript_cache.cached(deleted) is None


def test_a_transcript_written_after_the_deletion_is_discarded(db_session):
    job_id = uuid.uuid4()
    job_deletion.delete_job_data(job_id)  # 刪除先到：那時還沒有逐字稿

    save(db_session, job_id)  # 轉錄晚一步存檔
    assert job_deletion.discard_if_deleted(job_id) is True

    db_session.expire_all()
    assert count(db_session, Transcript, job_id) == 0


def test_a_job_that_was_not_deleted_keeps_what_was_written(db_session):
    job_id = uuid.uuid4()
    save(db_session, job_id)

    assert job_deletion.discard_if_deleted(job_id) is False
    assert count(db_session, Transcript, job_id) == 1


def test_the_pipeline_stops_without_reporting_when_the_job_was_deleted_while_transcribing(mocks):
    mocks.discard_if_deleted.return_value = True
    publish_completed, publish_failed = MagicMock(), MagicMock()
    body = json.dumps({"jobId": str(uuid.uuid4()), "storagePath": "uploads/foo.mp3", "fileType": "AUDIO"}).encode()

    pipeline.process_message(body, publish_completed, publish_failed)

    mocks.save_transcript.assert_called_once()
    statuses = [call.args[1] for call in mocks.job_status_client.update_status.call_args_list]
    assert statuses == ["TRANSCRIBING"]
    publish_completed.assert_not_called()
    publish_failed.assert_not_called()


class TestConsumer:
    @pytest.fixture
    def subscription(self):
        handled = []
        return handled, deletion_consumer.Subscription("job.deleted", "job.deleted.transcription",
                                                       "job.deleted.transcription.retry", handled.append)

    def test_a_handled_message_is_acked(self, subscription):
        handled, sub = subscription
        channel = MagicMock()

        deletion_consumer.handle(channel, 7, json.dumps({"jobId": str(uuid.uuid4())}).encode(), sub)

        assert len(handled) == 1
        channel.basic_ack.assert_called_once_with(delivery_tag=7)

    @pytest.mark.parametrize("body", [b"not json", b"[]", b'{"userId":"x"}'])
    def test_an_invalid_message_is_dropped(self, body):
        channel = MagicMock()
        sub = deletion_consumer.subscriptions()[0]

        deletion_consumer.handle(channel, 7, body, sub)

        channel.basic_ack.assert_called_once_with(delivery_tag=7)
        channel.basic_nack.assert_not_called()

    def test_a_failure_goes_to_the_retry_queue(self):
        def broken(_payload):
            raise RuntimeError("database down")
        channel = MagicMock()
        sub = deletion_consumer.Subscription("job.deleted", "q", "q.retry", broken)

        deletion_consumer.handle(channel, 7, b'{"jobId":"00000000-0000-0000-0000-000000000001"}', sub)

        channel.basic_nack.assert_called_once_with(delivery_tag=7, requeue=False)
        channel.basic_ack.assert_not_called()


def test_an_edit_that_lands_after_the_deletion_is_discarded_and_not_announced(
        transcription_stub, db_session, rabbitmq, monkeypatch):
    import grpc
    from app.proto_gen import transcription_pb2 as pb
    job_id = uuid.uuid4()
    save(db_session, job_id)
    segment_id = transcription_stub.GetTranscript(pb.GetTranscriptRequest(job_id=str(job_id))).segments[0].id
    # 編輯寫進資料庫的同時，job.deleted 也到了
    monkeypatch.setattr(job_deletion, "discard_if_deleted", lambda _job_id: True)

    with pytest.raises(grpc.RpcError) as error:
        transcription_stub.UpdateSegmentText(pb.UpdateSegmentTextRequest(
            job_id=str(job_id), segment_id=segment_id, text="改過"))

    assert error.value.code() == grpc.StatusCode.NOT_FOUND
    assert rabbitmq.published() == []
