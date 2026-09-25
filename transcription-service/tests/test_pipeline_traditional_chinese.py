import json
import uuid
from unittest.mock import MagicMock

import pytest

from app.services import pipeline
from app.services.transcriber import TranscriptResult, TranscriptSegment


@pytest.fixture
def run_pipeline(mocks):
    """讓 transcribe 回傳指定的轉錄結果、跑一次 process_message()，回傳實際交給存檔的內容。"""

    def _run(result: TranscriptResult) -> TranscriptResult:
        mocks.transcribe.return_value = result
        body = json.dumps(
            {"jobId": str(uuid.uuid4()), "storagePath": "uploads/foo.mp3", "fileType": "AUDIO"}).encode("utf-8")
        pipeline.process_message(body, MagicMock(), MagicMock())
        mocks.save_transcript.assert_called_once()
        return mocks.save_transcript.call_args.args[2]

    return _run


def test_simplified_chinese_transcript_is_saved_as_traditional(run_pipeline):
    saved = run_pipeline(TranscriptResult(
        language="Chinese",
        full_text="都可能会出现局部大雨 北台湾",
        segments=[
            TranscriptSegment(start=0.0, end=1.8, text="都可能会出现局部大雨"),
            TranscriptSegment(start=1.8, end=3.0, text="北台湾"),
        ],
    ))

    assert saved.full_text == "都可能會出現局部大雨 北臺灣"
    assert [seg.text for seg in saved.segments] == ["都可能會出現局部大雨", "北臺灣"]


def test_conversion_changes_glyphs_only_not_wording(run_pipeline):
    # s2twp 會把「软件」改寫成「軟體」、「局部」改寫成「區域性」——那等於改了說話者的用詞，
    # 逐字稿只換字形（見 app/services/traditional_chinese.py 的說明）。
    saved = run_pipeline(TranscriptResult(
        language="Chinese",
        full_text="软件 局部大雨",
        segments=[TranscriptSegment(start=0.0, end=2.0, text="软件 局部大雨")],
    ))

    assert saved.segments[0].text == "軟件 局部大雨"


def test_english_inside_chinese_transcript_is_left_unchanged(run_pipeline):
    saved = run_pipeline(TranscriptResult(
        language="Chinese",
        full_text="这个 API 很好用",
        segments=[TranscriptSegment(start=0.0, end=2.0, text="这个 API 很好用")],
    ))

    assert saved.segments[0].text == "這個 API 很好用"


def test_non_chinese_transcript_with_kanji_is_not_converted(run_pipeline):
    # 日文的新字體（国）會被 s2tw 轉成繁體字形（國），所以非中文一律不轉換。
    saved = run_pipeline(TranscriptResult(
        language="Japanese",
        full_text="今日は国に帰ります",
        segments=[TranscriptSegment(start=0.0, end=2.0, text="今日は国に帰ります")],
    ))

    assert saved.full_text == "今日は国に帰ります"
    assert saved.segments[0].text == "今日は国に帰ります"


@pytest.mark.parametrize("language", ["chinese", "Chinese", "zh", "zh-TW", "Mandarin"])
def test_chinese_language_variants_are_all_converted(run_pipeline, language):
    saved = run_pipeline(TranscriptResult(
        language=language,
        full_text="台风",
        segments=[TranscriptSegment(start=0.0, end=1.0, text="台风")],
    ))

    assert saved.segments[0].text == "颱風"


def test_english_transcript_is_saved_unchanged(run_pipeline):
    saved = run_pipeline(TranscriptResult(
        language="English",
        full_text="Today we talk about the budget.",
        segments=[TranscriptSegment(start=0.0, end=2.5, text="Today we talk about the budget.")],
    ))

    assert saved.language == "English"
    assert saved.full_text == "Today we talk about the budget."
    assert saved.segments[0].text == "Today we talk about the budget."
