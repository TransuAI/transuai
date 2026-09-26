import json
import logging
import uuid
from unittest.mock import MagicMock, patch

import grpc
import pytest
from pika.exceptions import AMQPConnectionError

from app.proto_gen import transcription_pb2
from app.repositories.transcript_repository import save_transcript
from app.services.transcript_result import TranscriptResult, TranscriptSegment


@pytest.fixture(autouse=True)
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


@pytest.fixture
def saved_job(db_session):
    """A transcript as the pipeline stores it, with three segments."""
    job_id = uuid.uuid4()
    save_transcript(db_session, job_id, TranscriptResult(
        language="Chinese",
        full_text="大家好 強風好雨 今天來聊預算",
        segments=[
            TranscriptSegment(0.0, 1.5, "大家好"),
            TranscriptSegment(1.5, 3.0, "強風好雨"),
            TranscriptSegment(3.0, 5.0, "今天來聊預算"),
        ],
    ))
    return str(job_id)


def get_transcript(stub, job_id):
    return stub.GetTranscript(transcription_pb2.GetTranscriptRequest(job_id=job_id))


def update_text(stub, job_id, segment_id, text):
    return stub.UpdateSegmentText(
        transcription_pb2.UpdateSegmentTextRequest(job_id=job_id, segment_id=segment_id, text=text))


def test_a_new_transcript_starts_at_revision_0_with_ids_and_original_texts(transcription_stub, saved_job):
    transcript = get_transcript(transcription_stub, saved_job)

    assert transcript.revision == 0
    assert all(segment.id for segment in transcript.segments)
    assert [s.original_text for s in transcript.segments] == ["大家好", "強風好雨", "今天來聊預算"]


def test_editing_a_segment_bumps_the_revision_and_keeps_the_original_text(transcription_stub, saved_job):
    segment_id = get_transcript(transcription_stub, saved_job).segments[1].id

    response = update_text(transcription_stub, saved_job, segment_id, "強風豪雨")

    assert response.revision == 1
    assert (response.segment.id, response.segment.text, response.segment.original_text) == (segment_id, "強風豪雨", "強風好雨")
    transcript = get_transcript(transcription_stub, saved_job)
    assert transcript.revision == 1
    assert [s.text for s in transcript.segments] == ["大家好", "強風豪雨", "今天來聊預算"]
    assert [(s.start_time, s.end_time) for s in transcript.segments] == [(0.0, 1.5), (1.5, 3.0), (3.0, 5.0)]
    assert transcript.full_text == "大家好\n強風豪雨\n今天來聊預算"


def test_saving_the_same_text_changes_nothing(transcription_stub, saved_job):
    segment_id = get_transcript(transcription_stub, saved_job).segments[0].id

    response = update_text(transcription_stub, saved_job, segment_id, "  大家好  ")

    assert response.revision == 0
    assert get_transcript(transcription_stub, saved_job).revision == 0


def test_text_is_trimmed_before_saving(transcription_stub, saved_job):
    segment_id = get_transcript(transcription_stub, saved_job).segments[1].id

    response = update_text(transcription_stub, saved_job, segment_id, "  強風豪雨\n")

    assert response.segment.text == "強風豪雨"


def test_clearing_a_segment_leaves_it_out_of_the_full_text_and_it_can_be_restored(transcription_stub, saved_job):
    segment = get_transcript(transcription_stub, saved_job).segments[1]

    cleared = update_text(transcription_stub, saved_job, segment.id, "   ")
    assert cleared.segment.text == ""
    assert get_transcript(transcription_stub, saved_job).full_text == "大家好\n今天來聊預算"

    restored = update_text(transcription_stub, saved_job, segment.id, segment.original_text)
    assert restored.segment.text == "強風好雨"
    assert restored.revision == 2
    assert get_transcript(transcription_stub, saved_job).full_text == "大家好\n強風好雨\n今天來聊預算"


def test_a_segment_of_another_jobs_transcript_is_not_found(transcription_stub, db_session, saved_job):
    other_job = uuid.uuid4()
    save_transcript(db_session, other_job, TranscriptResult("Chinese", "別人的", [TranscriptSegment(0, 1, "別人的")]))
    foreign_segment_id = get_transcript(transcription_stub, str(other_job)).segments[0].id

    with pytest.raises(grpc.RpcError) as error:
        update_text(transcription_stub, saved_job, foreign_segment_id, "改掉")

    assert error.value.code() == grpc.StatusCode.NOT_FOUND
    assert get_transcript(transcription_stub, str(other_job)).segments[0].text == "別人的"


def test_editing_a_job_without_a_transcript_is_not_found(transcription_stub):
    with pytest.raises(grpc.RpcError) as error:
        update_text(transcription_stub, str(uuid.uuid4()), str(uuid.uuid4()), "文字")

    assert error.value.code() == grpc.StatusCode.NOT_FOUND


@pytest.mark.parametrize("job_id, segment_id", [("not-a-uuid", str(uuid.uuid4())), (str(uuid.uuid4()), "nope")])
def test_malformed_ids_are_invalid(transcription_stub, job_id, segment_id):
    with pytest.raises(grpc.RpcError) as error:
        update_text(transcription_stub, job_id, segment_id, "文字")

    assert error.value.code() == grpc.StatusCode.INVALID_ARGUMENT


def test_text_over_the_length_limit_is_invalid(transcription_stub, saved_job):
    segment_id = get_transcript(transcription_stub, saved_job).segments[0].id

    with pytest.raises(grpc.RpcError) as error:
        update_text(transcription_stub, saved_job, segment_id, "字" * 2001)

    assert error.value.code() == grpc.StatusCode.INVALID_ARGUMENT
    assert get_transcript(transcription_stub, saved_job).revision == 0


def test_an_edit_publishes_transcript_edited_for_the_job(transcription_stub, saved_job, rabbitmq):
    segment_id = get_transcript(transcription_stub, saved_job).segments[1].id

    update_text(transcription_stub, saved_job, segment_id, "強風豪雨")

    assert rabbitmq.published() == [("transcript.edited", {"jobId": saved_job})]


def test_an_unchanged_save_publishes_nothing(transcription_stub, saved_job, rabbitmq):
    segment_id = get_transcript(transcription_stub, saved_job).segments[1].id

    update_text(transcription_stub, saved_job, segment_id, "強風好雨")

    assert rabbitmq.published() == []


def test_the_edit_is_kept_even_if_the_event_cannot_be_published(transcription_stub, saved_job, rabbitmq, caplog):
    rabbitmq.connection_class.side_effect = AMQPConnectionError("broker down")
    segment_id = get_transcript(transcription_stub, saved_job).segments[1].id

    with patch("app.services.edit_events.time.sleep"), caplog.at_level(logging.ERROR):
        response = update_text(transcription_stub, saved_job, segment_id, "強風豪雨")

    assert response.revision == 1
    assert get_transcript(transcription_stub, saved_job).segments[1].text == "強風豪雨"
    assert rabbitmq.connection_class.call_count == 3
    assert "TRANSCRIPTION_SERVICE_TRANSCRIPT_EDITED_EVENT_LOST" in caplog.text
