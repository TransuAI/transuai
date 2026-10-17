import pytest

from app.services.speech_recognition import Recognition, RecognizedWord
from app.services.transcript_result import TranscriptResult


@pytest.fixture
def transcribe(run_pipeline):
    """跑一次 pipeline，語音辨識回傳指定語言、一句一個片段（句與句之間停頓 1 秒）的結果；回傳實際交給存檔的逐字稿。"""

    def _transcribe(language: str, sentences: list[str]) -> TranscriptResult:
        return run_pipeline(Recognition(language=language, words=[
            RecognizedWord(start=2.0 * i, end=2.0 * i + 1.0, text=sentence, speaker=None)
            for i, sentence in enumerate(sentences)
        ]))

    return _transcribe


def test_simplified_chinese_transcript_is_saved_as_traditional(transcribe):
    saved = transcribe("Chinese", ["都可能会出现局部大雨", "北台湾"])

    assert saved.full_text == "都可能會出現局部大雨\n北臺灣"
    assert [seg.text for seg in saved.segments] == ["都可能會出現局部大雨", "北臺灣"]


def test_conversion_changes_glyphs_only_not_wording(transcribe):
    # s2twp 會把「软件」改寫成「軟體」、「局部」改寫成「區域性」——那等於改了說話者的用詞，
    # 逐字稿只換字形（見 app/services/traditional_chinese.py 的說明）。
    saved = transcribe("Chinese", ["软件 局部大雨"])

    assert saved.segments[0].text == "軟件 局部大雨"


def test_english_inside_chinese_transcript_is_left_unchanged(transcribe):
    saved = transcribe("Chinese", ["这个 API 很好用"])

    assert saved.segments[0].text == "這個 API 很好用"


def test_non_chinese_transcript_with_kanji_is_not_converted(transcribe):
    # 日文的新字體（国）會被 s2tw 轉成繁體字形（國），所以非中文一律不轉換。
    saved = transcribe("Japanese", ["今日は国に帰ります"])

    assert saved.full_text == "今日は国に帰ります"
    assert saved.segments[0].text == "今日は国に帰ります"


@pytest.mark.parametrize("language", ["chinese", "Chinese", "zh", "zh-TW", "Mandarin"])
def test_chinese_language_variants_are_all_converted(transcribe, language):
    saved = transcribe(language, ["台风"])

    assert saved.segments[0].text == "颱風"


def test_english_transcript_is_saved_unchanged(transcribe):
    saved = transcribe("English", ["Today we talk about the budget."])

    assert saved.language == "English"
    assert saved.full_text == "Today we talk about the budget."
    assert saved.segments[0].text == "Today we talk about the budget."
