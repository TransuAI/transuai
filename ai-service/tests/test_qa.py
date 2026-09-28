"""stream_answer() 這個 seam：檢索（repository）、transcript client 都 mock 掉，模型是假的 AI 廠商（HTTP 層），驗證交給 LLM 的上下文。
講者的名字在回答當下才向 transcription-service 拿**目前的**顯示名稱，embedding 本身只有片段文字。"""

import uuid
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import grpc
import pytest

from app.proto_gen import transcription_pb2
from app.services import qa


def segment(start: float, end: float, text: str, speaker: str = "") -> transcription_pb2.TranscriptSegment:
    return transcription_pb2.TranscriptSegment(start_time=start, end_time=end, text=text, speaker_label=speaker)


INTERVIEW = transcription_pb2.Transcript(
    segments=[
        segment(0.0, 2.0, "今天的來賓是誰", "S1"),
        segment(2.0, 4.5, "我覺得預算要再砍一成", "S2"),
        segment(4.5, 6.0, "主持人不同意", "S1"),
    ],
    speakers=[
        transcription_pb2.Speaker(label="S1", display_name="主持人", display_order=1),
        # Renamed after the embeddings were made: the answer must use the new name.
        transcription_pb2.Speaker(label="S2", display_name="王小明", display_order=2),
    ],
)


def chunk(start: str, end: str, text: str):
    # Embedding rows come back from Postgres with NUMERIC(10, 2) times.
    return SimpleNamespace(start_time=Decimal(start), end_time=Decimal(end), chunk_text=text)


@pytest.fixture
def answer(fake_llm):
    """Runs stream_answer() over the given retrieved chunks and transcript; returns the system prompt the
    (fake) provider received."""

    def _answer(chunks, transcript=None, transcript_error=None, summary=None, chapters=()):
        fake_llm.stream(["王小明認為", "預算要再砍一成。"])
        with (
            patch.object(qa, "find_by_job_id", return_value=[]),
            patch.object(qa, "find_summary", return_value=SimpleNamespace(summary_text=summary) if summary else None),
            patch.object(qa, "find_chapters", return_value=[
                SimpleNamespace(title=title, start_time=Decimal(start)) for title, start in chapters]),
            patch.object(qa, "embed_query", return_value=[0.1]),
            patch.object(qa, "find_similar", return_value=chunks),
            patch.object(qa, "transcript_client") as transcript_client,
        ):
            if transcript_error:
                transcript_client.get_transcript.side_effect = transcript_error
            else:
                transcript_client.get_transcript.return_value = transcript
            events = list(qa.stream_answer(MagicMock(name="session"), uuid.uuid4(), "王小明對預算怎麼看？", user_id=None))
        assert "".join(str(payload) for kind, payload in events if kind == "delta") == "王小明認為預算要再砍一成。"
        return fake_llm.bodies()[-1]["messages"][0]["content"]

    return _answer


def test_with_several_speakers_the_context_names_each_speaker_by_their_current_name(answer):
    prompt = answer([chunk("2.00", "4.50", "我覺得預算要再砍一成"), chunk("4.50", "6.00", "主持人不同意")], INTERVIEW)

    assert "[00:02] 王小明：我覺得預算要再砍一成" in prompt
    assert "[00:04] 主持人：主持人不同意" in prompt
    assert "用這些名字稱呼講者" in prompt


def test_with_a_single_speaker_the_context_carries_no_names(answer):
    solo = transcription_pb2.Transcript(
        segments=[segment(0.0, 2.0, "歡迎收聽", "S1")],
        speakers=[transcription_pb2.Speaker(label="S1", display_name="講者 1", display_order=1)],
    )

    prompt = answer([chunk("0.00", "2.00", "歡迎收聽")], solo)

    assert "[00:00] 歡迎收聽" in prompt
    assert "講者 1" not in prompt
    assert "稱呼講者" not in prompt


def test_a_chunk_that_matches_no_segment_is_given_without_a_name(answer):
    prompt = answer([chunk("9.00", "10.00", "對不上的片段")], INTERVIEW)

    assert "[00:09] 對不上的片段" in prompt


def test_when_the_transcript_cannot_be_fetched_it_still_answers_without_names(answer):
    error = grpc.RpcError()
    prompt = answer([chunk("2.00", "4.50", "我覺得預算要再砍一成")], transcript_error=error)

    assert "[00:02] 我覺得預算要再砍一成" in prompt


def test_the_summary_and_chapters_are_given_too_so_questions_about_the_whole_content_can_be_answered(answer):
    prompt = answer([chunk("754.00", "760.00", "我覺得預算要再砍一成")], INTERVIEW,
                    summary="這集節目在討論明年的預算。", chapters=[("開場", "0.00"), ("預算爭議", "754.00")])

    assert "這集節目在討論明年的預算。" in prompt
    assert "[00:00] 開場" in prompt and "[12:34] 預算爭議" in prompt
    assert "[12:34] 我覺得預算要再砍一成" in prompt  # times read like a clock, not 754.0s


def test_without_a_summary_only_the_retrieved_passages_are_given(answer):
    prompt = answer([chunk("2.00", "4.50", "我覺得預算要再砍一成")], INTERVIEW)

    assert "## 整段內容的摘要" not in prompt and "## 章節" not in prompt
    assert "[00:02] 王小明：我覺得預算要再砍一成" in prompt


def test_the_answer_is_asked_for_in_a_natural_voice_that_leads_with_the_answer(answer):
    prompt = answer([chunk("2.00", "4.50", "我覺得預算要再砍一成")], INTERVIEW, summary="摘要")

    assert "講結論" in prompt
    assert "不要提到「逐字稿」「片段」" in prompt  # the user doesn't know or care how the answer was looked up
    assert "只根據以下逐字稿片段" not in prompt


def test_a_follow_up_question_is_rewritten_by_the_model_before_searching(fake_llm):
    history = [SimpleNamespace(question="王小明是誰？", answer="他是這集的來賓。")]
    fake_llm.reply("王小明對預算怎麼看？")
    fake_llm.stream(["他認為要砍一成。"])

    with (
        patch.object(qa, "find_by_job_id", return_value=history),
        patch.object(qa, "embed_query", return_value=[0.1]) as embed_query,
        patch.object(qa, "find_similar", return_value=[chunk("2.00", "4.50", "我覺得預算要再砍一成")]),
        patch.object(qa, "transcript_client") as transcript_client,
    ):
        transcript_client.get_transcript.return_value = INTERVIEW
        list(qa.stream_answer(MagicMock(name="session"), uuid.uuid4(), "那他對預算怎麼看？", user_id=None))

    rewrite, answer = fake_llm.bodies()
    assert "王小明是誰？" in rewrite["messages"][0]["content"] and "那他對預算怎麼看？" in rewrite["messages"][0]["content"]
    embed_query.assert_called_once_with("王小明對預算怎麼看？")
    assert answer["stream"] is True
    assert answer["messages"][-1] == {"role": "user", "content": "那他對預算怎麼看？"}


def test_the_prompt_gives_no_example_time_the_model_could_copy(answer):
    prompt = answer([chunk("2.00", "4.50", "我覺得預算要再砍一成")], INTERVIEW, summary="摘要")

    instructions = prompt.split("## ")[0]
    assert "12:34" not in instructions  # a local model quoted the example as if it were a real time


def test_an_answer_that_drifts_into_simplified_chinese_reaches_the_user_in_traditional(fake_llm):
    fake_llm.stream(["这场会议确定了", "三项核心决策。"])
    with (
        patch.object(qa, "find_by_job_id", return_value=[]),
        patch.object(qa, "find_summary", return_value=None),
        patch.object(qa, "find_chapters", return_value=[]),
        patch.object(qa, "embed_query", return_value=[0.1]),
        patch.object(qa, "find_similar", return_value=[chunk("2.00", "4.50", "預算")]),
        patch.object(qa, "transcript_client"),
    ):
        events = list(qa.stream_answer(MagicMock(name="session"), uuid.uuid4(), "做了哪些決定？", user_id=None))

    assert "".join(str(payload) for kind, payload in events if kind == "delta") == "這場會議確定了三項核心決策。"
