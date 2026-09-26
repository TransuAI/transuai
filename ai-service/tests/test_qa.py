"""stream_answer() 這個 seam：檢索（repository）、transcript client、HF client 都 mock 掉，驗證交給 LLM 的上下文。
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


class FakeLlm:
    """Records the messages of each call and streams back a fixed answer."""

    def __init__(self):
        self.calls = []

    def create(self, **kwargs):
        self.calls.append(kwargs["messages"])
        delta = SimpleNamespace(content="王小明認為預算要再砍一成。")
        return iter([SimpleNamespace(choices=[SimpleNamespace(delta=delta)])])

    def system_prompt(self):
        return self.calls[-1][0]["content"]


@pytest.fixture
def answer():
    """Runs stream_answer() over the given retrieved chunks and transcript; returns the fake LLM."""

    def _answer(chunks, transcript=None, transcript_error=None):
        llm = FakeLlm()
        client = SimpleNamespace(chat=SimpleNamespace(completions=llm))
        with (
            patch.object(qa, "find_by_job_id", return_value=[]),
            patch.object(qa, "embed_query", return_value=[0.1]),
            patch.object(qa, "find_similar", return_value=chunks),
            patch.object(qa, "transcript_client") as transcript_client,
            patch.object(qa, "get_client", return_value=client),
        ):
            if transcript_error:
                transcript_client.get_transcript.side_effect = transcript_error
            else:
                transcript_client.get_transcript.return_value = transcript
            events = list(qa.stream_answer(MagicMock(name="session"), uuid.uuid4(), "王小明對預算怎麼看？"))
        assert events[-1] == ("delta", "王小明認為預算要再砍一成。")
        return llm

    return _answer


def test_with_several_speakers_the_context_names_each_speaker_by_their_current_name(answer):
    llm = answer([chunk("2.00", "4.50", "我覺得預算要再砍一成"), chunk("4.50", "6.00", "主持人不同意")], INTERVIEW)

    prompt = llm.system_prompt()
    assert "[2.0s] 王小明：我覺得預算要再砍一成" in prompt
    assert "[4.5s] 主持人：主持人不同意" in prompt
    assert "用這些名字稱呼講者" in prompt


def test_with_a_single_speaker_the_context_carries_no_names(answer):
    solo = transcription_pb2.Transcript(
        segments=[segment(0.0, 2.0, "歡迎收聽", "S1")],
        speakers=[transcription_pb2.Speaker(label="S1", display_name="講者 1", display_order=1)],
    )

    prompt = answer([chunk("0.00", "2.00", "歡迎收聽")], solo).system_prompt()

    assert "[0.0s] 歡迎收聽" in prompt
    assert "講者 1" not in prompt
    assert "稱呼講者" not in prompt


def test_a_chunk_that_matches_no_segment_is_given_without_a_name(answer):
    prompt = answer([chunk("9.00", "10.00", "對不上的片段")], INTERVIEW).system_prompt()

    assert "[9.0s] 對不上的片段" in prompt


def test_when_the_transcript_cannot_be_fetched_it_still_answers_without_names(answer):
    error = grpc.RpcError()
    prompt = answer([chunk("2.00", "4.50", "我覺得預算要再砍一成")], transcript_error=error).system_prompt()

    assert "[2.0s] 我覺得預算要再砍一成" in prompt
