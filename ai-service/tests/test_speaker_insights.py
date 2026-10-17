"""講者數據的 AI 判斷（.scratch/speaker-analytics/issues/02）：每位講者提出的問題、可能的打斷。打斷的候選由程式先挑（換人、
間隔很短），模型只判斷候選；模型只回行號，存下的原話一定是那個片段的文字——對不上的一律丟掉。"""

import json
from types import SimpleNamespace

import pytest

from app.services.llm_client import platform_chat_model
from app.services.speaker_insights import (
    Insight, InsightFormatError, analyze_speakers, interruption_candidates, numbered_segments)


def segment(start: float, end: float, speaker: str | None, text: str):
    return SimpleNamespace(start_time=start, end_time=end, speaker_label=speaker, text=text)


def speaker(label: str, order: int, name: str | None = None):
    return SimpleNamespace(label=label, display_name=name or f"講者 {order}", display_order=order)


SPEAKERS = [speaker("S1", 1, "主持人"), speaker("S2", 2), speaker("S3", 3)]
SEGMENTS = [
    segment(0.0, 4.0, "S1", "今天討論預算 大家覺得呢"),          # 1
    segment(4.1, 9.0, "S2", "我覺得可以再省一點 但是"),           # 2: 0.1s after S1 — a candidate
    segment(9.05, 12.0, "S3", "等一下 那行銷怎麼辦"),            # 3: 0.05s after S2 — a candidate
    segment(12.0, 13.0, "S3", ""),                              # cleared: not a line
    segment(15.0, 18.0, "S1", "好 那行銷的部分下週再談"),         # 4: 3s after — not a candidate
]


def transcript(segments=SEGMENTS, speakers=SPEAKERS):
    return SimpleNamespace(full_text="", revision=3, segments=segments, speakers=speakers)


class TestInterruptionCandidates:
    def test_a_change_of_speaker_right_after_the_last_one_stopped_is_a_candidate(self):
        lines = numbered_segments(transcript())

        assert interruption_candidates(lines) == [2, 3]

    def test_a_pause_or_the_same_speaker_going_on_is_not(self):
        lines = numbered_segments(transcript([
            segment(0, 4, "S1", "第一句"),
            segment(4.1, 6, "S1", "還是我"),       # same speaker
            segment(7.0, 9, "S2", "停了一秒才講"),  # 1s gap
        ]))

        assert interruption_candidates(lines) == []

    def test_overlapping_speech_counts(self):
        lines = numbered_segments(transcript([segment(0, 5, "S1", "我還沒講完"), segment(4.5, 7, "S2", "可是")]))

        assert interruption_candidates(lines) == [2]


class TestNumberedSegments:
    def test_cleared_segments_are_left_out_and_lines_are_numbered_from_one(self):
        lines = numbered_segments(transcript())

        assert [line.number for line in lines] == [1, 2, 3, 4]
        assert lines[3].text == "好 那行銷的部分下週再談"


class TestAnalyzeSpeakers:
    def analyze(self, fake_llm, reply):
        fake_llm.reply(json.dumps(reply, ensure_ascii=False))
        return analyze_speakers(transcript(), model=platform_chat_model(), meter=None)

    def test_questions_and_interruptions_keep_the_segments_own_words_and_speakers(self, fake_llm):
        insights = self.analyze(fake_llm, {"questions": [1, 3], "interruptions": [3]})

        assert insights == [
            Insight("question", "S1", None, 0.0, "今天討論預算 大家覺得呢"),
            Insight("question", "S3", None, 9.05, "等一下 那行銷怎麼辦"),
            Insight("interruption", "S3", "S2", 9.05, "等一下 那行銷怎麼辦"),
        ]

    def test_the_prompt_numbers_the_lines_with_names_and_lists_the_candidates(self, fake_llm):
        self.analyze(fake_llm, {"questions": [], "interruptions": []})

        prompt = fake_llm.bodies()[0]["messages"][0]["content"]
        assert "[1] [00:00] 主持人：今天討論預算 大家覺得呢" in prompt
        assert "[3] [00:09] 講者 3：等一下 那行銷怎麼辦" in prompt
        assert "可能的打斷：第 2 行、第 3 行" in prompt

    def test_line_numbers_that_dont_exist_or_arent_candidates_are_dropped(self, fake_llm):
        insights = self.analyze(fake_llm, {"questions": [0, 9, "x", 4, 4], "interruptions": [4, 1]})

        assert insights == [Insight("question", "S1", None, 15.0, "好 那行銷的部分下週再談")]

    @pytest.mark.parametrize("reply", ["不是 JSON", "[]", '{"questions": "1"}'])
    def test_a_reply_that_isnt_the_expected_json_is_a_format_error(self, fake_llm, reply):
        fake_llm.reply(reply)

        with pytest.raises(InsightFormatError):
            analyze_speakers(transcript(), model=platform_chat_model(), meter=None)

    def test_with_fewer_than_two_speakers_there_is_nothing_to_analyze(self, fake_llm):
        solo = transcript([segment(0, 3, "S1", "只有我"), segment(3.1, 5, "S1", "還是我")])

        assert analyze_speakers(solo, model=platform_chat_model(), meter=None) == []
        assert fake_llm.bodies() == []
