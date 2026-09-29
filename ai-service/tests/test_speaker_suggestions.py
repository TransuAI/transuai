"""講者名字建議（見 CONTEXT.md「講者名字建議」、.scratch/speaker-name-suggestions）：pipeline 在摘要之後請模型依錄音裡明確講出
的話替還沒改名的講者提名字，程式再驗證（名字在依據的原話裡、時間對得到、講者對得上、不重複）。

兩個 seam：process_message()（假的 AI 廠商在 HTTP 層，gRPC client、embedder 與資料庫是 mock），與 gRPC 的列出／改狀態（真的
Postgres）。"""

import json
import uuid
from contextlib import contextmanager
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import grpc
import pytest

from app.proto_gen import ai_pb2
from app.repositories.speaker_suggestion_repository import SpeakerSuggestionRecord, save_speaker_suggestions
from app.services import pipeline, usage_meter

JOB_ID = str(uuid.uuid4())


def segment(start: float, speaker: str, text: str):
    return SimpleNamespace(start_time=start, end_time=start + 2, speaker_label=speaker, text=text)


def speaker(label: str, order: int, name: str | None = None):
    return SimpleNamespace(label=label, display_name=name or f"講者 {order}", display_order=order)


# Shaped like the GitLab key review: a self-introduction, someone introducing the next speaker, and a
# "thanks X" that says nothing about who is speaking.
SEGMENTS = [
    segment(2.0, "S1", "Hi."),
    segment(2.5, "S1", "This is Eric Johnson."),
    segment(20.0, "S2", "Thanks Eric. I'm Sid."),
    segment(40.0, "S3", "Next, Jennifer will cover UX."),
    segment(50.0, "S4", "Thanks. So the UX team shipped the new navigation."),
    segment(70.0, "S3", "Thanks Eric, that makes sense."),
]
SPEAKERS = [speaker("S1", 1), speaker("S2", 2), speaker("S3", 3), speaker("S4", 4)]


def transcript(segments=SEGMENTS, speakers=SPEAKERS):
    return SimpleNamespace(full_text="", revision=0, segments=segments, speakers=speakers)


@contextmanager
def running_the_pipeline(the_transcript=None):
    """Runs one transcription.completed message; yields (job_status_client, save_speaker_suggestions)."""
    with (
        patch.object(pipeline, "job_status_client") as job_status_client,
        patch.object(pipeline, "transcript_client") as transcript_client,
        patch.object(pipeline, "embed_documents", side_effect=lambda texts: [[0.1]] * len(texts)),
        patch.object(pipeline, "new_session", return_value=MagicMock(name="session")),
        patch.object(pipeline, "save_summary"),
        patch.object(pipeline, "save_chapters"),
        patch.object(pipeline, "save_embeddings"),
        patch.object(pipeline, "save_speaker_suggestions") as save,
    ):
        transcript_client.get_transcript.return_value = the_transcript or transcript()
        yield job_status_client, save
        pipeline.process_message(json.dumps({"jobId": JOB_ID}).encode(), MagicMock(), MagicMock())


def model_says(fake_llm, suggestions) -> None:
    fake_llm.reply("GitLab 工程部的 Key Review。")  # summary
    fake_llm.reply("[]")  # chapters
    fake_llm.reply('{"title": "GitLab Key Review", "category": "meeting"}')  # title
    fake_llm.reply(suggestions if isinstance(suggestions, str) else json.dumps(suggestions))  # speaker names


def suggested(save) -> list[tuple[str, str, float, str]]:
    (records,) = save.call_args.args[1:]
    return [(r.speaker_label, r.name, r.evidence_start_time, r.evidence_text) for r in records]


def test_a_speaker_who_introduces_themselves_gets_that_name_suggested(fake_llm):
    model_says(fake_llm, [{"speaker": "講者 1", "name": "Eric Johnson", "time": "00:02", "kind": "self"}])

    with running_the_pipeline() as (_, save):
        pass

    assert suggested(save) == [("S1", "Eric Johnson", 2.5, "This is Eric Johnson.")]
    prompt = fake_llm.bodies()[3]["messages"][0]["content"]
    assert "[00:02] 講者 1：This is Eric Johnson." in prompt


def test_a_speaker_introduced_by_the_one_before_gets_that_name_suggested(fake_llm):
    model_says(fake_llm, [{"speaker": "講者 4", "name": "Jennifer", "time": "00:40", "kind": "introduced"}])

    with running_the_pipeline() as (_, save):
        pass

    assert suggested(save) == [("S4", "Jennifer", 40.0, "Next, Jennifer will cover UX.")]


def test_someone_introduced_is_not_suggested_for_a_speaker_who_did_not_speak_next(fake_llm):
    model_says(fake_llm, [{"speaker": "講者 2", "name": "Jennifer", "time": "00:40", "kind": "introduced"}])

    with running_the_pipeline() as (_, save):
        pass

    assert suggested(save) == []


def test_thanking_someone_does_not_make_the_speaker_that_person(fake_llm):
    model_says(fake_llm, [{"speaker": "講者 3", "name": "Eric", "time": "01:10", "kind": "self"}])

    with running_the_pipeline() as (_, save):
        pass

    assert suggested(save) == []  # 「Thanks Eric」 was said by 講者 3, and 講者 3 isn't Eric


@pytest.mark.parametrize("answer", [
    {"speaker": "講者 2", "name": "Sid Sijbrandij", "time": "00:20", "kind": "self"},  # the full name was never said
    {"speaker": "講者 1", "name": "Eric Johnson", "time": "05:00", "kind": "self"},  # nothing said at 05:00
    {"speaker": "講者 9", "name": "Eric Johnson", "time": "00:02", "kind": "self"},  # no such speaker
    {"speaker": "講者 1", "name": "Eric Johnson", "time": "00:02", "kind": "guess"},  # neither self nor introduced
])
def test_a_suggestion_without_grounds_in_the_recording_is_dropped(fake_llm, answer):
    model_says(fake_llm, [answer])

    with running_the_pipeline() as (_, save):
        pass

    assert suggested(save) == []


def test_a_name_suggested_for_two_speakers_is_dropped_for_both(fake_llm):
    two_erics = transcript(segments=[segment(2.0, "S1", "This is Eric."), segment(20.0, "S2", "Hi, I'm Eric from sales.")],
                           speakers=[speaker("S1", 1), speaker("S2", 2)])
    model_says(fake_llm, [
        {"speaker": "講者 1", "name": "Eric", "time": "00:02", "kind": "self"},
        {"speaker": "講者 2", "name": "Eric", "time": "00:20", "kind": "self"},
    ])

    with running_the_pipeline(two_erics) as (_, save):
        pass

    assert suggested(save) == []


def test_a_speaker_the_user_already_named_gets_no_suggestion(fake_llm):
    renamed = [speaker("S1", 1), speaker("S2", 2, "Sid"), speaker("S3", 3), speaker("S4", 4)]
    model_says(fake_llm, [
        {"speaker": "Sid", "name": "Sid", "time": "00:20", "kind": "self"},
        {"speaker": "講者 1", "name": "Eric Johnson", "time": "00:02", "kind": "self"},
    ])

    with running_the_pipeline(transcript(speakers=renamed)) as (_, save):
        pass

    assert [s[0] for s in suggested(save)] == ["S1"]


def test_a_recording_with_one_speaker_is_not_asked_about(fake_llm):
    solo = transcript(segments=[segment(0.0, "S1", "大家好，我是王小明")], speakers=[speaker("S1", 1)])
    fake_llm.reply("摘要")
    fake_llm.reply("[]")
    fake_llm.reply('{"title": "王小明", "category": "podcast"}')

    with running_the_pipeline(solo) as (_, save):
        pass

    assert len(fake_llm.requests) == 3  # the summary, the chapters and the title only
    save.assert_not_called()


@pytest.mark.parametrize("failure", ["not json", "error"])
def test_a_failure_leaves_the_speakers_as_they_are_and_the_job_completed(fake_llm, failure):
    if failure == "error":
        fake_llm.reply("GitLab 工程部的 Key Review。")
        fake_llm.reply("[]")
        fake_llm.reply('{"title": "GitLab Key Review", "category": "meeting"}')
        fake_llm.fail(400)
    else:
        model_says(fake_llm, "講者 1 是 Eric Johnson")

    with running_the_pipeline() as (job_status_client, save):
        pass

    save.assert_not_called()
    job_status_client.update_status.assert_called_with(JOB_ID, "COMPLETED")


def test_the_call_is_recorded_as_the_speaker_names_usage(fake_llm):
    model_says(fake_llm, [])

    with patch.object(usage_meter, "save_llm_usage") as save_llm_usage, running_the_pipeline():
        pass

    assert [c.args[0].feature for c in save_llm_usage.call_args_list][-1] == "speaker_names"


# --- 透過 gRPC：列出與改狀態（真的 Postgres） ---

def record(label: str, name: str) -> SpeakerSuggestionRecord:
    return SpeakerSuggestionRecord(speaker_label=label, name=name, evidence_start_time=2.5,
                                   evidence_text=f"This is {name}.")


def test_the_suggestions_are_listed_and_can_be_applied_or_dismissed(ai_stub, db_session):
    job_id = uuid.uuid4()
    save_speaker_suggestions(job_id, [record("S1", "Eric Johnson"), record("S4", "Jennifer")])

    ai_stub.SetSpeakerSuggestionStatus(ai_pb2.SetSpeakerSuggestionStatusRequest(
        job_id=str(job_id), speaker_label="S1", status="applied"))
    ai_stub.SetSpeakerSuggestionStatus(ai_pb2.SetSpeakerSuggestionStatusRequest(
        job_id=str(job_id), speaker_label="S4", status="dismissed"))

    listed = ai_stub.ListSpeakerSuggestions(ai_pb2.ListSpeakerSuggestionsRequest(job_id=str(job_id))).suggestions
    assert [(s.speaker_label, s.name, s.evidence_start_time, s.evidence_text, s.status) for s in listed] == [
        ("S1", "Eric Johnson", 2.5, "This is Eric Johnson.", "applied"),
        ("S4", "Jennifer", 2.5, "This is Jennifer.", "dismissed"),
    ]
    other_job = ai_stub.ListSpeakerSuggestions(ai_pb2.ListSpeakerSuggestionsRequest(job_id=str(uuid.uuid4())))
    assert list(other_job.suggestions) == []


def test_saving_again_replaces_the_jobs_suggestions(ai_stub, db_session):
    job_id = uuid.uuid4()
    save_speaker_suggestions(job_id, [record("S1", "Eric")])
    save_speaker_suggestions(job_id, [record("S1", "Eric Johnson")])  # the pipeline ran again (a retried message)

    listed = ai_stub.ListSpeakerSuggestions(ai_pb2.ListSpeakerSuggestionsRequest(job_id=str(job_id))).suggestions
    assert [(s.speaker_label, s.name, s.status) for s in listed] == [("S1", "Eric Johnson", "pending")]


@pytest.mark.parametrize("label, status, code", [
    ("S1", "pending", grpc.StatusCode.INVALID_ARGUMENT),  # only applied or dismissed
    ("S9", "applied", grpc.StatusCode.NOT_FOUND),
])
def test_a_status_that_cannot_be_set_is_refused(ai_stub, db_session, label, status, code):
    job_id = uuid.uuid4()
    save_speaker_suggestions(job_id, [record("S1", "Eric Johnson")])

    with pytest.raises(grpc.RpcError) as error:
        ai_stub.SetSpeakerSuggestionStatus(ai_pb2.SetSpeakerSuggestionStatusRequest(
            job_id=str(job_id), speaker_label=label, status=status))

    assert error.value.code() == code
