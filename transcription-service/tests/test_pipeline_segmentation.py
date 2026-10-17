import pytest

from app.services.speech_recognition import Recognition, RecognizedWord
from app.services.transcript_result import TranscriptResult


def word(start: float, end: float, text: str, speaker: str | None = "0") -> RecognizedWord:
    return RecognizedWord(start=start, end=end, text=text, speaker=speaker)


@pytest.fixture
def transcribe(run_pipeline):
    """跑一次 pipeline，語音辨識回傳這些字；回傳實際交給存檔的逐字稿。"""
    return lambda words, language="zh-TW": run_pipeline(Recognition(language=language, words=words))


def texts(result: TranscriptResult) -> list[str]:
    return [segment.text for segment in result.segments]


def test_a_new_segment_starts_when_the_speaker_changes(transcribe):
    saved = transcribe([
        word(0.0, 0.4, "你好", speaker="0"),
        word(0.4, 0.8, "嗎", speaker="0"),
        word(0.8, 1.2, "很好", speaker="1"),
        word(1.2, 1.6, "謝謝", speaker="0"),
    ])

    assert texts(saved) == ["你好嗎", "很好", "謝謝"]
    assert [(s.start, s.end) for s in saved.segments] == [(0.0, 0.8), (0.8, 1.2), (1.2, 1.6)]


def test_speakers_are_numbered_in_order_of_first_appearance(transcribe):
    # The vendor's own labels mean nothing to the user; the first person to speak is always 講者 1.
    saved = transcribe([
        word(0.0, 1.0, "主持人開場", speaker="3"),
        word(1.0, 2.0, "來賓回答", speaker="0"),
        word(2.0, 3.0, "主持人追問", speaker="3"),
        word(3.0, 4.0, "第三個人", speaker="7"),
    ])

    assert [s.speaker_label for s in saved.segments] == ["S1", "S2", "S1", "S3"]


def test_a_segment_ends_after_sentence_final_punctuation(transcribe):
    saved = transcribe([
        word(0.0, 0.5, "今天開會。"),
        word(0.5, 1.0, "先談預算？"),
        word(1.0, 1.5, "好！"),
        word(1.5, 2.0, "Next"),
        word(2.0, 2.5, "item."),
        word(2.5, 3.0, "嗯……"),
        word(3.0, 3.5, "結束"),
    ])

    assert texts(saved) == ["今天開會。", "先談預算？", "好！", "Next item.", "嗯……", "結束"]


def test_a_pause_of_half_a_second_or_more_starts_a_new_segment(transcribe):
    # Chinese transcripts come back with almost no punctuation, so pauses are where sentences end.
    saved = transcribe([
        word(0.0, 0.5, "第一句"),
        word(0.9, 1.4, "還是第一句"),  # 0.4s gap: same segment
        word(1.9, 2.4, "第二句"),  # 0.5s gap: new segment
    ])

    assert texts(saved) == ["第一句還是第一句", "第二句"]


def test_pauses_are_measured_in_milliseconds_not_raw_floats(transcribe):
    # 1.2 - 0.7 is 0.49999999999999994 in floating point, but it is a 0.5s pause.
    saved = transcribe([word(0.2, 0.7, "第一句"), word(1.2, 1.5, "第二句")])

    assert texts(saved) == ["第一句", "第二句"]


def test_sentence_final_punctuation_inside_closing_quotes_still_ends_the_segment(transcribe):
    saved = transcribe([word(0.0, 0.5, "他說「好。」"), word(0.5, 1.0, "然後呢")])

    assert texts(saved) == ["他說「好。」", "然後呢"]


def test_a_segment_is_cut_at_a_word_boundary_before_it_exceeds_15_seconds(transcribe):
    saved = transcribe([word(float(i), float(i + 1), f"字{i}") for i in range(20)])

    assert [(s.start, s.end) for s in saved.segments] == [(0.0, 15.0), (15.0, 20.0)]
    assert saved.segments[1].text == "字15字16字17字18字19"


def test_without_speaker_information_segments_have_no_speaker(transcribe):
    saved = transcribe([
        word(0.0, 0.5, "沒有", speaker=None),
        word(0.5, 1.0, "講者資訊", speaker=None),
    ])

    assert texts(saved) == ["沒有講者資訊"]
    assert saved.segments[0].speaker_label is None


def test_a_word_without_speaker_among_labelled_words_gets_its_own_segment(transcribe):
    saved = transcribe([
        word(0.0, 0.5, "有講者", speaker="0"),
        word(0.5, 1.0, "沒講者", speaker=None),
        word(1.0, 1.5, "又有講者", speaker="0"),
    ])

    assert [(s.text, s.speaker_label) for s in saved.segments] == [
        ("有講者", "S1"), ("沒講者", None), ("又有講者", "S1")]


def test_each_segment_belongs_to_exactly_one_speaker(transcribe):
    saved = transcribe([word(i * 0.2, i * 0.2 + 0.2, f"字{i}", speaker=str(i % 3 // 2)) for i in range(30)])

    assert all(s.speaker_label in ("S1", "S2") for s in saved.segments)
    assert "".join(texts(saved)) == "".join(f"字{i}" for i in range(30))
    labels_per_word = [str(i % 3 // 2) for i in range(30)]
    boundaries = [i for i in range(1, 30) if labels_per_word[i] != labels_per_word[i - 1]]
    assert len(saved.segments) == len(boundaries) + 1


def test_words_without_text_are_ignored(transcribe):
    saved = transcribe([word(0.0, 0.5, "有字"), word(0.5, 0.6, " "), word(0.6, 1.0, "還有字")])

    assert texts(saved) == ["有字還有字"]


def test_chinese_is_joined_without_spaces_and_english_with_one(transcribe):
    saved = transcribe([
        word(0.0, 0.3, "我們用"),
        word(0.3, 0.6, "API"),
        word(0.6, 0.9, "key"),
        word(0.9, 1.2, "來"),
        word(1.2, 1.5, "驗證，"),
        word(1.5, 1.8, "ok"),
        word(1.8, 2.1, "嗎"),
    ])

    assert texts(saved) == ["我們用API key來驗證，ok嗎"]


def test_english_words_after_punctuation_keep_their_space(transcribe):
    saved = transcribe([word(0.0, 0.3, "Well,"), word(0.3, 0.6, "hello"), word(0.6, 0.9, "there")], language="en")

    assert texts(saved) == ["Well, hello there"]


def test_full_text_is_the_segments_one_per_line(transcribe):
    saved = transcribe([word(0.0, 0.5, "第一句", speaker="0"), word(0.5, 1.0, "第二句", speaker="1")])

    assert saved.full_text == "第一句\n第二句"


def test_simplified_characters_are_converted_after_segmentation(transcribe):
    # Deepgram's zh-TW output still leaks Simplified characters now and then.
    saved = transcribe([word(0.0, 0.5, "很多人都"), word(0.5, 1.0, "问我")])

    assert texts(saved) == ["很多人都問我"]
    assert saved.full_text == "很多人都問我"


def test_silence_produces_an_empty_transcript(transcribe):
    saved = transcribe([])

    assert saved.segments == []
    assert saved.full_text == ""
