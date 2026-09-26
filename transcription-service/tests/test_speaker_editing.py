import uuid

import grpc
import pytest

from app.proto_gen import transcription_pb2
from app.repositories.transcript_repository import save_transcript
from app.services.transcript_result import TranscriptResult, TranscriptSegment

pytestmark = pytest.mark.usefixtures("rabbitmq")


@pytest.fixture
def interview(db_session):
    """A two-speaker transcript as the pipeline stores it: 講者 1 (S1) asks, 講者 2 (S2) answers."""
    job_id = uuid.uuid4()
    save_transcript(db_session, job_id, TranscriptResult(
        language="zh-TW",
        full_text="今天的來賓是誰\n大家好我是王小明\n歡迎你",
        segments=[
            TranscriptSegment(0.0, 2.0, "今天的來賓是誰", speaker_label="S1"),
            TranscriptSegment(2.0, 4.0, "大家好我是王小明", speaker_label="S2"),
            TranscriptSegment(4.0, 5.0, "歡迎你", speaker_label="S1"),
        ],
        speaker_labels=["S1", "S2"],
    ))
    return str(job_id)


def speakers(stub, job_id):
    transcript = stub.GetTranscript(transcription_pb2.GetTranscriptRequest(job_id=job_id))
    return [(s.label, s.display_name) for s in transcript.speakers], transcript.revision


def rename(stub, job_id, label, name):
    return stub.RenameSpeaker(transcription_pb2.RenameSpeakerRequest(job_id=job_id, label=label, name=name))


def test_renaming_a_speaker_names_them_everywhere_and_bumps_the_revision(transcription_stub, interview):
    response = rename(transcription_stub, interview, "S2", "  王小明 ")

    assert (response.speaker.label, response.speaker.display_name, response.revision) == ("S2", "王小明", 1)
    assert speakers(transcription_stub, interview) == ([("S1", "講者 1"), ("S2", "王小明")], 1)


def test_clearing_the_name_restores_the_default_name(transcription_stub, interview):
    rename(transcription_stub, interview, "S2", "王小明")

    response = rename(transcription_stub, interview, "S2", "")

    assert (response.speaker.display_name, response.revision) == ("講者 2", 2)


def test_the_same_name_changes_nothing(transcription_stub, interview, rabbitmq):
    rename(transcription_stub, interview, "S2", "王小明")

    response = rename(transcription_stub, interview, "S2", "王小明")

    assert response.revision == 1
    assert rabbitmq.published() == [("transcript.edited", {"jobId": interview})]


def test_typing_the_default_name_is_not_a_rename(transcription_stub, interview, rabbitmq):
    response = rename(transcription_stub, interview, "S2", "講者 2")

    assert (response.speaker.display_name, response.revision) == ("講者 2", 0)
    assert rabbitmq.published() == []


def test_a_rename_publishes_transcript_edited_once(transcription_stub, interview, rabbitmq):
    rename(transcription_stub, interview, "S1", "主持人")

    assert rabbitmq.published() == [("transcript.edited", {"jobId": interview})]


def test_an_unknown_speaker_is_not_found(transcription_stub, interview):
    with pytest.raises(grpc.RpcError) as error:
        rename(transcription_stub, interview, "S9", "誰")

    assert error.value.code() == grpc.StatusCode.NOT_FOUND


def test_renaming_in_a_job_without_a_transcript_is_not_found(transcription_stub):
    with pytest.raises(grpc.RpcError) as error:
        rename(transcription_stub, str(uuid.uuid4()), "S1", "誰")

    assert error.value.code() == grpc.StatusCode.NOT_FOUND


def test_a_name_over_100_characters_is_invalid(transcription_stub, interview):
    with pytest.raises(grpc.RpcError) as error:
        rename(transcription_stub, interview, "S1", "名" * 101)

    assert error.value.code() == grpc.StatusCode.INVALID_ARGUMENT


def test_a_malformed_job_id_is_invalid(transcription_stub):
    with pytest.raises(grpc.RpcError) as error:
        rename(transcription_stub, "not-a-uuid", "S1", "誰")

    assert error.value.code() == grpc.StatusCode.INVALID_ARGUMENT
