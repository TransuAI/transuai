"""標出可以查核的主張（.scratch/fact-check/issues/01）：模型讀有行號的逐字稿，每條主張回行號、照抄的原話、整理成一句完整可搜尋的陳述、
種類（數字／事實）、能不能查核；程式驗證原話真的在那一行（或前後一行），對不上的丟掉。存下的原話、時間與講者一律取那個片段本身。"""

import json
from types import SimpleNamespace

import pytest

from app.services.claim_extractor import ClaimFormatError, ExtractedClaim, extract_claims
from app.services.llm_client import platform_chat_model


def segment(start: float, speaker: str | None, text: str):
    return SimpleNamespace(start_time=start, end_time=start + 4, speaker_label=speaker, text=text)


SEGMENTS = [
    segment(0.0, "S1", "歡迎收聽本集節目"),                         # 1
    segment(4.0, "S2", "台灣大概有三成的人每天聽 Podcast"),           # 2
    segment(8.0, "S2", ""),                                          # cleared: not a line
    segment(12.0, "S1", "這個法規去年已經修改了"),                     # 3
    segment(16.0, "S2", "我小時候每天都走路上學"),                     # 4
]
SPEAKERS = [SimpleNamespace(label="S1", display_name="主持人", display_order=1),
            SimpleNamespace(label="S2", display_name="講者 2", display_order=2)]


def transcript(segments=SEGMENTS):
    return SimpleNamespace(full_text="", revision=2, segments=segments, speakers=SPEAKERS)


def claim(**overrides):
    item = {"line": 2, "quote": "三成的人每天聽 Podcast", "claim": "台灣約有 30% 的人每天收聽 Podcast", "kind": "number",
            "checkable": True}
    return item | overrides


def extract(fake_llm, items, the_transcript=None):
    fake_llm.reply(json.dumps(items, ensure_ascii=False))
    return extract_claims(the_transcript or transcript(), model=platform_chat_model(), meter=None)


def test_a_grounded_claim_keeps_the_segment_it_was_said_in(fake_llm):
    assert extract(fake_llm, [claim()]) == [ExtractedClaim(
        claim="台灣約有 30% 的人每天收聽 Podcast", kind="number", checkable=True, speaker_label="S2", start_time=4.0,
        text="台灣大概有三成的人每天聽 Podcast")]


def test_the_prompt_numbers_the_spoken_lines_with_speakers(fake_llm):
    extract(fake_llm, [])

    prompt = fake_llm.bodies()[0]["messages"][0]["content"]
    assert "[2] [00:04] 講者 2：台灣大概有三成的人每天聽 Podcast" in prompt
    assert "[3] [00:12] 主持人：這個法規去年已經修改了" in prompt


def test_something_only_the_speaker_knows_is_kept_but_not_checkable(fake_llm):
    [kept] = extract(fake_llm, [claim(line=4, quote="我小時候每天都走路上學", claim="講者小時候每天走路上學", kind="fact",
                                      checkable=False)])

    assert (kept.checkable, kept.kind) == (False, "fact")


def test_claims_come_back_in_the_order_they_were_said(fake_llm):
    found = extract(fake_llm, [claim(line=3, quote="法規去年已經修改", claim="某法規在去年修改", kind="fact"), claim()])

    assert [c.start_time for c in found] == [4.0, 12.0]


@pytest.mark.parametrize("item", [
    claim(quote="一半的人都在聽"),  # not said
    claim(line=4, quote="三成的人每天聽 Podcast"),  # said, but two lines away
    claim(line=99),
    claim(claim=""),
    claim(kind="opinion"),
    "not an object",
])
def test_anything_not_grounded_or_not_a_claim_is_dropped(fake_llm, item):
    assert extract(fake_llm, [item]) == []


def test_simplified_chinese_is_written_traditional(fake_llm):
    [kept] = extract(fake_llm, [claim(claim="台湾约有三成的人每天收听播客")])

    assert kept.claim == "臺灣約有三成的人每天收聽播客"  # the shared converter's 臺


def test_a_reply_that_is_not_a_json_array_is_a_format_error(fake_llm):
    fake_llm.reply('{"claims": []}')

    with pytest.raises(ClaimFormatError):
        extract_claims(transcript(), model=platform_chat_model(), meter=None)
