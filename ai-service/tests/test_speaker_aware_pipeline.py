"""摘要與章節知道講者是誰：只有兩位以上講者時，輸入的每一行帶上講者目前的名稱（見 speaker-diarization spec）。
驅動方式跟 tests/test_pipeline.py 一樣，mock 在 pipeline / regeneration 模組「使用端」的名稱。"""

import json
import uuid
from unittest.mock import MagicMock, patch

from app.proto_gen import transcription_pb2
from app.services import pipeline, regeneration
from app.services.chapter_generator import TimedLine


def segment(start: float, text: str, speaker: str = "") -> transcription_pb2.TranscriptSegment:
    return transcription_pb2.TranscriptSegment(start_time=start, end_time=start + 2, text=text, speaker_label=speaker)


def speaker(label: str, name: str, order: int) -> transcription_pb2.Speaker:
    return transcription_pb2.Speaker(label=label, display_name=name, display_order=order)


INTERVIEW = transcription_pb2.Transcript(
    full_text="今天的來賓是誰\n大家好我是王小明\n歡迎你",
    revision=2,
    segments=[
        segment(0.0, "今天的來賓是誰", "S1"),
        segment(2.0, "大家好我是王小明", "S2"),
        segment(4.0, "", "S2"),  # cleared
        segment(6.0, "歡迎你", "S1"),
    ],
    speakers=[speaker("S1", "主持人", 1), speaker("S2", "講者 2", 2)],
)

SOLO = transcription_pb2.Transcript(
    full_text="歡迎收聽\n今天聊預算",
    segments=[segment(0.0, "歡迎收聽", "S1"), segment(2.0, "今天聊預算", "S1")],
    speakers=[speaker("S1", "講者 1", 1)],
)


def run_pipeline(transcript):
    with (
        patch.object(pipeline, "job_status_client"),
        patch.object(pipeline, "transcript_client") as transcript_client,
        patch.object(pipeline, "summarize", return_value="摘要") as summarize,
        patch.object(pipeline, "generate_chapters", return_value=[]) as generate_chapters,
        patch.object(pipeline, "embed_documents", side_effect=lambda texts: [[0.1]] * len(texts)) as embed_documents,
        patch.object(pipeline, "new_session", return_value=MagicMock(name="session")),
        patch.object(pipeline, "save_summary"),
        patch.object(pipeline, "save_chapters"),
        patch.object(pipeline, "save_embeddings"),
    ):
        transcript_client.get_transcript.return_value = transcript
        pipeline.process_message(json.dumps({"jobId": str(uuid.uuid4())}).encode(), MagicMock(), MagicMock())
    return summarize.call_args.args[0], generate_chapters.call_args.args[0], embed_documents.call_args.args[0]


def test_with_several_speakers_the_summary_reads_each_line_as_name_and_text():
    summary_input, _, _ = run_pipeline(INTERVIEW)

    assert summary_input == "主持人：今天的來賓是誰\n講者 2：大家好我是王小明\n主持人：歡迎你"


def test_with_several_speakers_each_chapter_line_carries_the_speakers_name():
    _, chapter_input, _ = run_pipeline(INTERVIEW)

    assert chapter_input == [
        TimedLine(0.0, "主持人：今天的來賓是誰"),
        TimedLine(2.0, "講者 2：大家好我是王小明"),
        TimedLine(6.0, "主持人：歡迎你"),
    ]


def test_embeddings_stay_on_the_segment_text_alone():
    # 名字會改，embedding 不能因為改名就過期——問答在回答當下才換上目前的名字。
    _, _, embedded = run_pipeline(INTERVIEW)

    assert embedded == ["今天的來賓是誰", "大家好我是王小明", "歡迎你"]


def test_with_a_single_speaker_the_input_stays_as_it_was():
    summary_input, chapter_input, _ = run_pipeline(SOLO)

    assert summary_input == "歡迎收聽\n今天聊預算"
    assert chapter_input == [TimedLine(0.0, "歡迎收聽"), TimedLine(2.0, "今天聊預算")]


def test_a_second_speaker_whose_segments_are_all_cleared_does_not_count():
    only_host_left = transcription_pb2.Transcript()
    only_host_left.CopyFrom(INTERVIEW)
    only_host_left.segments[1].text = ""

    summary_input, _, _ = run_pipeline(only_host_left)

    assert summary_input == INTERVIEW.full_text


def test_a_transcript_from_before_speaker_separation_stays_as_it_was():
    old = transcription_pb2.Transcript(full_text="第一句\n第二句", segments=[segment(0.0, "第一句"), segment(2.0, "第二句")])

    summary_input, chapter_input, _ = run_pipeline(old)

    assert summary_input == "第一句\n第二句"
    assert chapter_input == [TimedLine(0.0, "第一句"), TimedLine(2.0, "第二句")]


def test_regenerating_uses_the_speakers_current_names_too():
    renamed = transcription_pb2.Transcript()
    renamed.CopyFrom(INTERVIEW)
    renamed.speakers[1].display_name = "王小明"

    with (
        patch.object(regeneration, "transcript_client") as transcript_client,
        patch.object(regeneration, "summarize", return_value="新摘要") as summarize,
        patch.object(regeneration, "generate_chapters", return_value=[]) as generate_chapters,
        patch.object(regeneration, "new_session", return_value=MagicMock(name="session")),
        patch.object(regeneration, "replace_summary_and_chapters"),
    ):
        transcript_client.get_transcript.return_value = renamed
        regeneration.process_regeneration_requested(json.dumps({"jobId": str(uuid.uuid4())}).encode())

    assert summarize.call_args.args[0] == "主持人：今天的來賓是誰\n王小明：大家好我是王小明\n主持人：歡迎你"
    assert generate_chapters.call_args.args[0][1] == TimedLine(2.0, "王小明：大家好我是王小明")
