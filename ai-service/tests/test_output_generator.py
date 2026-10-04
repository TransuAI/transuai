"""多格式輸出的產生（.scratch/multi-format-outputs/issues/01）：依摘要、章節、講者寫成某種格式的 Markdown。時間戳一律從章節來——
模型寫的時間丟掉，章節清單由程式附上。中文一律繁體。"""

import pytest

from app.services.llm_client import platform_chat_model
from app.services.output_generator import OutputFormatError, OutputSource, generate_output

SOURCE = OutputSource(
    title="產品週會",
    summary="討論了下一季的預算，決定先刪減行銷費用，並請小明下週提出新版本。",
    chapters=[("開場與近況", 0.0), ("預算討論", 125.0), ("下一步", 3605.0)],
    speakers=["主持人", "小明"],
)


def test_a_podcast_description_is_the_models_text_followed_by_the_chapters_with_their_real_times(fake_llm):
    fake_llm.reply("這一集我們聊下一季的預算。\n\n重點：\n- 先刪減行銷費用\n- 小明下週提出新版本")

    content = generate_output("podcast_description", SOURCE, model=platform_chat_model(), meter=None)

    assert content == (
        "這一集我們聊下一季的預算。\n\n重點：\n- 先刪減行銷費用\n- 小明下週提出新版本\n\n"
        "## 章節\n\n00:00 開場與近況\n02:05 預算討論\n1:00:05 下一步\n"
    )


def test_the_prompt_carries_the_summary_chapters_and_speakers_and_asks_for_no_times(fake_llm):
    fake_llm.reply("介紹")

    generate_output("podcast_description", SOURCE, model=platform_chat_model(), meter=None)

    prompt = fake_llm.bodies()[0]["messages"][0]["content"]
    assert SOURCE.summary in prompt
    assert "預算討論" in prompt and "主持人、小明" in prompt
    assert "不要寫時間" in prompt


def test_times_the_model_writes_itself_are_dropped(fake_llm):
    fake_llm.reply("簡介\n\n00:00 開場\n[02:05] 預算\n- 1:00:05 下一步\n- 一個重點")

    content = generate_output("podcast_description", SOURCE, model=platform_chat_model(), meter=None)

    assert content.startswith("簡介\n\n- 一個重點\n\n## 章節")


def test_simplified_chinese_comes_back_traditional(fake_llm):
    fake_llm.reply("这一集我们聊预算。")

    content = generate_output("podcast_description", SOURCE, model=platform_chat_model(), meter=None)

    assert content.startswith("這一集我們聊預算。")


def test_without_chapters_there_is_no_chapter_list(fake_llm):
    fake_llm.reply("簡介")

    content = generate_output("podcast_description", OutputSource("", "摘要", [], []), model=platform_chat_model(), meter=None)

    assert content == "簡介\n"


@pytest.mark.parametrize("reply", ["", "   \n  "])
def test_an_empty_reply_is_a_format_error(fake_llm, reply):
    fake_llm.reply(reply)

    with pytest.raises(OutputFormatError):
        generate_output("podcast_description", SOURCE, model=platform_chat_model(), meter=None)


def test_an_unknown_format_is_refused_before_asking_the_model(fake_llm):
    with pytest.raises(ValueError):
        generate_output("press_release", SOURCE, model=platform_chat_model(), meter=None)
    assert fake_llm.bodies() == []
