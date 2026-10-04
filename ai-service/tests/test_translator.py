"""翻譯一批片段（.scratch/transcript-translation/issues/01）：一次送一批（附前面幾句當上下文、只翻這一批），要模型回同樣數量、同樣編號的
JSON；對不上就是格式錯誤。中文目標一律繁體。"""

import json

import pytest

from app.services.llm_client import platform_chat_model
from app.services.translator import LANGUAGES, TranslationFormatError, translate_batch

BATCH = [("seg-a", "Hi, this is Eric."), ("seg-b", "Let's talk about the budget.")]


def reply(fake_llm, items):
    fake_llm.reply(json.dumps(items, ensure_ascii=False))


def test_each_segment_comes_back_translated_under_its_own_id(fake_llm):
    reply(fake_llm, [{"n": 1, "text": "嗨，我是 Eric。"}, {"n": 2, "text": "我們來談預算。"}])

    translated = translate_batch(BATCH, "zh-TW", context=[], model=platform_chat_model(), meter=None)

    assert translated == {"seg-a": "嗨，我是 Eric。", "seg-b": "我們來談預算。"}


def test_the_prompt_numbers_the_lines_names_the_language_and_carries_context_not_to_translate(fake_llm):
    reply(fake_llm, [{"n": 1, "text": "a"}, {"n": 2, "text": "b"}])

    translate_batch(BATCH, "ja", context=["Earlier line."], model=platform_chat_model(), meter=None)

    prompt = fake_llm.bodies()[0]["messages"][0]["content"]
    assert "日本語" in prompt
    assert '{"n": 1, "text": "Hi, this is Eric."}' in prompt
    assert "Earlier line." in prompt and "不用翻譯" in prompt


def test_chinese_comes_back_traditional(fake_llm):
    reply(fake_llm, [{"n": 1, "text": "我们来谈预算"}, {"n": 2, "text": "好"}])

    translated = translate_batch(BATCH, "zh-TW", context=[], model=platform_chat_model(), meter=None)

    assert translated["seg-a"] == "我們來談預算"


@pytest.mark.parametrize("answer", [
    "不是 JSON",
    '{"n": 1}',
    '[{"n": 1, "text": "只翻了一句"}]',
    '[{"n": 1, "text": "a"}, {"n": 3, "text": "多了一句"}]',
    '[{"n": 1, "text": "a"}, {"n": 2, "text": ""}]',
])
def test_a_reply_that_doesnt_match_the_batch_is_a_format_error(fake_llm, answer):
    fake_llm.reply(answer)

    with pytest.raises(TranslationFormatError):
        translate_batch(BATCH, "en", context=[], model=platform_chat_model(), meter=None)


def test_the_languages_on_offer():
    assert set(LANGUAGES) == {"zh-TW", "en", "ja", "ko"}
