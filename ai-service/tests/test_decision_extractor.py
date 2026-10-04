"""抽出一場會議的決策（.scratch/decision-log/issues/01）：模型讀摘要、章節與有行號的逐字稿，每個決策回行號與照抄的原話；程式驗證原話
真的在那一行（或前後一行），對不上的丟掉——寧可漏，也不要編。存下的原話與時間一律取那個片段本身。"""

import json
from types import SimpleNamespace

import pytest

from app.services.decision_extractor import DecisionFormatError, ExtractedDecision, extract_decisions
from app.services.llm_client import platform_chat_model


def segment(start: float, speaker: str | None, text: str):
    return SimpleNamespace(start_time=start, end_time=start + 4, speaker_label=speaker, text=text)


def speaker(label: str, order: int, name: str | None = None):
    return SimpleNamespace(label=label, display_name=name or f"講者 {order}", display_order=order)


SEGMENTS = [
    segment(0.0, "S1", "今天要決定資料庫"),                         # 1
    segment(4.0, "S2", "我覺得用 PostgreSQL 因為我們需要 pgvector"),  # 2
    segment(8.0, "S1", ""),                                          # cleared: not a line
    segment(12.0, "S1", "MySQL 也有考慮過 但是沒有向量"),              # 3
    segment(16.0, "S1", "好 那就決定用 PostgreSQL"),                  # 4
    segment(20.0, "S2", "上線日期先訂月底 下週再確認"),                 # 5
]
SPEAKERS = [speaker("S1", 1, "主持人"), speaker("S2", 2)]


def transcript(segments=SEGMENTS, speakers=SPEAKERS):
    return SimpleNamespace(full_text="", revision=4, segments=segments, speakers=speakers)


def decision(**overrides):
    item = {"statement": "資料庫用 PostgreSQL", "rationale": "需要 pgvector 做向量搜尋", "alternatives": ["MySQL"],
            "proposed_by": "講者 2", "tentative": False, "line": 4, "quote": "那就決定用 PostgreSQL"}
    return item | overrides


def extract(fake_llm, items, the_transcript=None):
    fake_llm.reply(json.dumps(items, ensure_ascii=False))
    return extract_decisions(the_transcript or transcript(), "討論資料庫與上線日期", [("資料庫選擇", 0.0)],
                             model=platform_chat_model(), meter=None)


def test_a_grounded_decision_keeps_what_the_model_said_and_the_segment_it_was_made_in(fake_llm):
    assert extract(fake_llm, [decision()]) == [ExtractedDecision(
        statement="資料庫用 PostgreSQL", rationale="需要 pgvector 做向量搜尋", alternatives=["MySQL"], proposed_by="S2",
        tentative=False, start_time=16.0, evidence_text="好 那就決定用 PostgreSQL")]


def test_the_prompt_numbers_the_spoken_lines_with_speakers_and_carries_the_summary_and_chapters(fake_llm):
    extract(fake_llm, [])

    prompt = fake_llm.bodies()[0]["messages"][0]["content"]
    assert "[4] [00:16] 主持人：好 那就決定用 PostgreSQL" in prompt
    assert "[5] [00:20] 講者 2：上線日期先訂月底 下週再確認" in prompt
    assert "討論資料庫與上線日期" in prompt and "[00:00] 資料庫選擇" in prompt


def test_a_quote_from_the_line_next_to_it_still_counts(fake_llm):
    [kept] = extract(fake_llm, [decision(line=3, quote="那就決定用 PostgreSQL")])

    assert (kept.start_time, kept.evidence_text) == (12.0, "MySQL 也有考慮過 但是沒有向量")


@pytest.mark.parametrize("item", [
    decision(quote="我們決定改用 MongoDB"),  # not said anywhere
    decision(line=1, quote="那就決定用 PostgreSQL"),  # said, but three lines away
    decision(line=99),
    decision(line="4"),
    decision(statement=""),
    decision(quote=""),
    "not an object",
])
def test_anything_not_grounded_in_the_recording_is_dropped(fake_llm, item):
    assert extract(fake_llm, [item]) == []


def test_an_unknown_speaker_only_loses_who_proposed_it(fake_llm):
    [kept] = extract(fake_llm, [decision(proposed_by="王小明")])

    assert kept.proposed_by is None


def test_a_tentative_decision_without_reasons_or_alternatives(fake_llm):
    [kept] = extract(fake_llm, [decision(statement="上線日期暫定月底", rationale=None, alternatives=None, proposed_by=None,
                                         tentative=True, line=5, quote="上線日期先訂月底")])

    assert (kept.tentative, kept.rationale, kept.alternatives, kept.proposed_by) == (True, "", [], None)


def test_simplified_chinese_is_written_traditional(fake_llm):
    [kept] = extract(fake_llm, [decision(statement="数据库用 PostgreSQL", rationale="需要向量检索", alternatives=["关系型数据库"])])

    assert (kept.statement, kept.rationale, kept.alternatives) == ("數據庫用 PostgreSQL", "需要向量檢索", ["關係型數據庫"])


def test_a_single_speaker_recording_has_no_names_and_no_proposer(fake_llm):
    alone = transcript([segment(0.0, "S1", "好 那就決定用 PostgreSQL")], [speaker("S1", 1)])

    [kept] = extract(fake_llm, [decision(line=1, proposed_by="講者 1")], alone)

    assert "[1] [00:00] 好 那就決定用 PostgreSQL" in fake_llm.bodies()[0]["messages"][0]["content"]
    assert kept.proposed_by is None


def test_a_reply_that_is_not_a_json_array_is_a_format_error(fake_llm):
    fake_llm.reply('{"decisions": []}')

    with pytest.raises(DecisionFormatError):
        extract_decisions(transcript(), "", [], model=platform_chat_model(), meter=None)
