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


# --- 改片段的講者 / 新增講者 ---


def segment_ids(stub, job_id):
    return [s.id for s in stub.GetTranscript(transcription_pb2.GetTranscriptRequest(job_id=job_id)).segments]


def assign_to(stub, job_id, segment_id, label):
    return stub.AssignSegmentSpeaker(transcription_pb2.AssignSegmentSpeakerRequest(
        job_id=job_id, segment_id=segment_id, speaker_label=label))


def assign_new(stub, job_id, segment_id, name=""):
    return stub.AssignSegmentSpeaker(transcription_pb2.AssignSegmentSpeakerRequest(
        job_id=job_id, segment_id=segment_id, new_speaker=transcription_pb2.NewSpeaker(name=name)))


def segment_speakers(stub, job_id):
    return [s.speaker_label for s in stub.GetTranscript(transcription_pb2.GetTranscriptRequest(job_id=job_id)).segments]


def test_a_segment_can_be_given_to_another_speaker(transcription_stub, interview, rabbitmq):
    last = segment_ids(transcription_stub, interview)[2]

    response = assign_to(transcription_stub, interview, last, "S2")

    assert (response.segment.id, response.segment.speaker_label, response.revision) == (last, "S2", 1)
    assert segment_speakers(transcription_stub, interview) == ["S1", "S2", "S2"]
    assert rabbitmq.published() == [("transcript.edited", {"jobId": interview})]


def test_a_new_speaker_comes_last_in_display_order_and_can_be_named(transcription_stub, interview):
    last = segment_ids(transcription_stub, interview)[2]

    response = assign_new(transcription_stub, interview, last, " 李大華 ")

    assert response.segment.speaker_label == "S3"
    assert [(s.label, s.display_name, s.display_order) for s in response.speakers] == [
        ("S1", "講者 1", 1), ("S2", "講者 2", 2), ("S3", "李大華", 3)]
    assert response.revision == 1
    assert segment_speakers(transcription_stub, interview) == ["S1", "S2", "S3"]


def test_a_new_speaker_without_a_name_gets_the_default_name(transcription_stub, interview):
    response = assign_new(transcription_stub, interview, segment_ids(transcription_stub, interview)[0])

    assert [s.display_name for s in response.speakers] == ["講者 1", "講者 2", "講者 3"]


def test_giving_a_segment_to_its_own_speaker_changes_nothing(transcription_stub, interview, rabbitmq):
    response = assign_to(transcription_stub, interview, segment_ids(transcription_stub, interview)[1], "S2")

    assert response.revision == 0
    assert rabbitmq.published() == []


def test_in_a_transcript_without_speakers_the_other_segments_become_speaker_1(transcription_stub, db_session):
    """講者分離之前的舊 Job：沒有講者、片段沒有講者，當成只有一位講者。指定出新講者後就是兩位。"""
    job_id = uuid.uuid4()
    save_transcript(db_session, job_id, TranscriptResult(
        language="Chinese", full_text="第一句\n第二句",
        segments=[TranscriptSegment(0.0, 1.0, "第一句"), TranscriptSegment(1.0, 2.0, "第二句")]))
    second = segment_ids(transcription_stub, str(job_id))[1]

    response = assign_new(transcription_stub, str(job_id), second)

    assert [(s.label, s.display_name) for s in response.speakers] == [("S1", "講者 1"), ("S2", "講者 2")]
    assert segment_speakers(transcription_stub, str(job_id)) == ["S1", "S2"]


def test_an_unknown_target_speaker_is_not_found(transcription_stub, interview):
    with pytest.raises(grpc.RpcError) as error:
        assign_to(transcription_stub, interview, segment_ids(transcription_stub, interview)[0], "S9")

    assert error.value.code() == grpc.StatusCode.NOT_FOUND


def test_a_segment_of_another_job_is_not_found(transcription_stub, db_session, interview):
    other_job = uuid.uuid4()
    save_transcript(db_session, other_job, TranscriptResult(
        language="zh-TW", full_text="別人的", segments=[TranscriptSegment(0.0, 1.0, "別人的", speaker_label="S1")],
        speaker_labels=["S1"]))
    other_segment = segment_ids(transcription_stub, str(other_job))[0]

    with pytest.raises(grpc.RpcError) as error:
        assign_to(transcription_stub, interview, other_segment, "S1")

    assert error.value.code() == grpc.StatusCode.NOT_FOUND


def test_assigning_in_a_job_without_a_transcript_is_not_found(transcription_stub):
    with pytest.raises(grpc.RpcError) as error:
        assign_to(transcription_stub, str(uuid.uuid4()), str(uuid.uuid4()), "S1")

    assert error.value.code() == grpc.StatusCode.NOT_FOUND


def test_a_request_without_a_target_is_invalid(transcription_stub, interview):
    with pytest.raises(grpc.RpcError) as error:
        transcription_stub.AssignSegmentSpeaker(transcription_pb2.AssignSegmentSpeakerRequest(
            job_id=interview, segment_id=segment_ids(transcription_stub, interview)[0]))

    assert error.value.code() == grpc.StatusCode.INVALID_ARGUMENT


def test_a_new_speakers_name_over_100_characters_is_invalid(transcription_stub, interview):
    with pytest.raises(grpc.RpcError) as error:
        assign_new(transcription_stub, interview, segment_ids(transcription_stub, interview)[0], "名" * 101)

    assert error.value.code() == grpc.StatusCode.INVALID_ARGUMENT


@pytest.mark.parametrize("job_id, segment_id", [("not-a-uuid", str(uuid.uuid4())), (str(uuid.uuid4()), "not-a-uuid")])
def test_malformed_ids_are_invalid_when_assigning(transcription_stub, job_id, segment_id):
    with pytest.raises(grpc.RpcError) as error:
        assign_to(transcription_stub, job_id, segment_id, "S1")

    assert error.value.code() == grpc.StatusCode.INVALID_ARGUMENT
