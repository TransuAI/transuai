"""cache-aside：逐字稿（見 .scratch/pre-launch-hardening/issues/06）。GetTranscript 被問答的每一題、出題、會後處理、重新產生摘要與前端
讀取；讀的時候先查 Redis，沒有才讀資料庫並寫回；每一種編輯之後，下一次讀到的一定是新版。"""

import time
import uuid
from unittest.mock import patch

import grpc
import pytest

from app.controllers import transcript_controller
from app.core.config import settings
from app.proto_gen import transcription_pb2
from app.repositories.transcript_repository import save_transcript
from app.services import pipeline, transcript_cache
from app.services.speech_recognition import Recognition
from app.services.transcript_result import TranscriptResult, TranscriptSegment


def saved_transcript(db_session) -> uuid.UUID:
    job_id = uuid.uuid4()
    save_transcript(db_session, job_id, TranscriptResult(
        language="zh-TW",
        full_text="主持人開場\n來賓回答",
        segments=[TranscriptSegment(0.0, 1.0, "主持人開場", speaker_label="S1"),
                  TranscriptSegment(1.0, 2.0, "來賓回答", speaker_label="S2")],
        speaker_labels=["S1", "S2"],
    ))
    return job_id


def read(stub, job_id):
    return stub.GetTranscript(transcription_pb2.GetTranscriptRequest(job_id=str(job_id)))


def test_a_transcript_read_again_comes_from_the_cache(transcription_stub, db_session):
    job_id = saved_transcript(db_session)

    with patch.object(transcript_controller, "find_by_job_id", wraps=transcript_controller.find_by_job_id) as find:
        first, second = read(transcription_stub, job_id), read(transcription_stub, job_id)

    assert find.call_count == 1
    assert second == first


def test_after_editing_a_segment_the_new_text_is_read_straight_away(transcription_stub, db_session):
    job_id = saved_transcript(db_session)
    segment = read(transcription_stub, job_id).segments[0]

    transcription_stub.UpdateSegmentText(transcription_pb2.UpdateSegmentTextRequest(
        job_id=str(job_id), segment_id=segment.id, text="主持人開場白"))

    assert read(transcription_stub, job_id).segments[0].text == "主持人開場白"


def test_after_renaming_a_speaker_the_new_name_is_read_straight_away(transcription_stub, db_session):
    job_id = saved_transcript(db_session)
    read(transcription_stub, job_id)

    transcription_stub.RenameSpeaker(transcription_pb2.RenameSpeakerRequest(job_id=str(job_id), label="S1", name="王經理"))

    assert read(transcription_stub, job_id).speakers[0].display_name == "王經理"


def test_after_moving_a_segment_to_another_speaker_the_change_is_read_straight_away(transcription_stub, db_session):
    job_id = saved_transcript(db_session)
    segment = read(transcription_stub, job_id).segments[0]

    transcription_stub.AssignSegmentSpeaker(transcription_pb2.AssignSegmentSpeakerRequest(
        job_id=str(job_id), segment_id=segment.id, speaker_label="S2"))

    assert read(transcription_stub, job_id).segments[0].speaker_label == "S2"


def test_a_read_from_before_an_edit_that_writes_back_late_does_not_bring_the_old_version_back(
        transcription_stub, db_session):
    job_id = saved_transcript(db_session)
    before = read(transcription_stub, job_id)  # revision 1
    transcription_stub.UpdateSegmentText(transcription_pb2.UpdateSegmentTextRequest(
        job_id=str(job_id), segment_id=before.segments[0].id, text="新的開場"))

    transcript_cache.remember(job_id, before)  # 編輯之前就開始的讀取，這時才寫回

    assert read(transcription_stub, job_id).segments[0].text == "新的開場"


def test_a_transcript_is_cached_for_a_limited_time(transcription_stub, db_session, redis_client):
    job_id = saved_transcript(db_session)
    read(transcription_stub, job_id)

    assert 0 < redis_client.ttl(transcript_cache._key(job_id)) <= settings.transcript_cache_ttl_seconds


def test_a_transcript_that_does_not_exist_is_not_cached(transcription_stub, db_session, redis_client):
    job_id = uuid.uuid4()

    with pytest.raises(grpc.RpcError) as error:
        read(transcription_stub, job_id)

    assert error.value.code() == grpc.StatusCode.NOT_FOUND
    assert redis_client.exists(transcript_cache._key(job_id)) == 0


def test_transcripts_are_read_from_the_database_when_redis_is_down(transcription_stub, db_session):
    job_id = saved_transcript(db_session)
    unreachable = transcript_cache._new_client(host="localhost", port=1)

    with patch.object(transcript_cache, "_client", unreachable):
        started = time.monotonic()
        transcript = read(transcription_stub, job_id)
        took = time.monotonic() - started
        transcription_stub.RenameSpeaker(transcription_pb2.RenameSpeakerRequest(
            job_id=str(job_id), label="S1", name="王經理"))
        renamed = read(transcription_stub, job_id)

    assert transcript.segments[0].text == "主持人開場"
    assert renamed.speakers[0].display_name == "王經理"
    assert took < 2  # redis-py 預設會重試 10 次（實測 3.7 秒以上）；不重試，連不上就放棄


@pytest.mark.parametrize("text, expected", [("", ""), ("主持人開場", "主持人開場")])
def test_clearing_or_restoring_a_segment_is_read_straight_away(transcription_stub, db_session, text, expected):
    job_id = saved_transcript(db_session)
    segment = read(transcription_stub, job_id).segments[0]
    transcription_stub.UpdateSegmentText(transcription_pb2.UpdateSegmentTextRequest(
        job_id=str(job_id), segment_id=segment.id, text="改過的"))
    read(transcription_stub, job_id)

    transcription_stub.UpdateSegmentText(transcription_pb2.UpdateSegmentTextRequest(
        job_id=str(job_id), segment_id=segment.id, text=text))  # 清空，或還原成原文

    assert read(transcription_stub, job_id).segments[0].text == expected


def test_after_giving_a_segment_to_a_new_speaker_the_new_speaker_is_read_straight_away(transcription_stub, db_session):
    job_id = saved_transcript(db_session)
    segment = read(transcription_stub, job_id).segments[0]

    transcription_stub.AssignSegmentSpeaker(transcription_pb2.AssignSegmentSpeakerRequest(
        job_id=str(job_id), segment_id=segment.id, new_speaker=transcription_pb2.NewSpeaker(name="來賓")))

    assert [s.display_name for s in read(transcription_stub, job_id).speakers] == ["講者 1", "講者 2", "來賓"]


def test_the_pipeline_drops_a_cached_transcript_when_it_saves_one(run_pipeline):
    # 訊息重送時 pipeline 會再存一次；之前的那份可能已經被讀過、記在快取裡。
    with patch.object(pipeline, "transcript_cache") as cache:
        run_pipeline(Recognition(language="en", words=[]))

    cache.record_edit.assert_called_once()
