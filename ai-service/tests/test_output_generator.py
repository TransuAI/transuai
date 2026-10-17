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


# --- 02：YouTube 描述、部落格文章、電子報、社群貼文 ---


def test_a_youtube_description_starts_its_chapters_at_0_00_so_youtube_reads_them_as_chapters(fake_llm):
    fake_llm.reply("影片簡介")
    late_start = OutputSource("", "摘要", [("開場", 2.0), ("預算", 125.0)], [])

    content = generate_output("youtube_description", late_start, model=platform_chat_model(), meter=None)

    assert content.endswith("## 章節\n\n00:00 開場\n02:05 預算\n")


@pytest.mark.parametrize("format_name", ["blog_post", "newsletter"])
def test_a_blog_post_or_newsletter_has_no_chapter_list(fake_llm, format_name):
    fake_llm.reply("# 標題\n\n內文")

    content = generate_output(format_name, SOURCE, model=platform_chat_model(), meter=None)

    assert content == "# 標題\n\n內文\n"


def test_a_social_post_is_written_for_the_chosen_platform_and_its_length(fake_llm):
    fake_llm.reply("貼文 #預算")

    content = generate_output("social_post", SOURCE, model=platform_chat_model(), meter=None, platform="threads")

    prompt = fake_llm.bodies()[0]["messages"][0]["content"]
    assert "Threads" in prompt and "500" in prompt
    assert content == "貼文 #預算\n"


def test_a_social_post_needs_a_known_platform(fake_llm):
    with pytest.raises(ValueError):
        generate_output("social_post", SOURCE, model=platform_chat_model(), meter=None, platform="myspace")
    with pytest.raises(ValueError):
        generate_output("social_post", SOURCE, model=platform_chat_model(), meter=None)
    assert fake_llm.bodies() == []


def test_the_users_own_request_goes_into_the_prompt_after_the_rules(fake_llm):
    fake_llm.reply("文章")
    source = OutputSource("", "摘要", [], [], instruction="寫給工程師看")

    generate_output("blog_post", source, model=platform_chat_model(), meter=None)

    prompt = fake_llm.bodies()[0]["messages"][0]["content"]
    assert prompt.index("寫作規則") < prompt.index("寫給工程師看")


# --- review：語言跟著逐字稿、hashtag ---


def test_an_english_recording_gets_an_english_output_and_it_isnt_converted(fake_llm):
    fake_llm.reply("This episode covers the budget.")
    english = OutputSource("", "討論了預算。", [], [], language="en")

    content = generate_output("podcast_description", english, model=platform_chat_model(), meter=None)

    assert "請用 English 寫" in fake_llm.bodies()[0]["messages"][0]["content"]
    assert content == "This episode covers the budget.\n"


def test_a_chinese_recording_gets_traditional_chinese(fake_llm):
    fake_llm.reply("介紹")

    generate_output("podcast_description", SOURCE, model=platform_chat_model(), meter=None)

    assert "請用 繁體中文（台灣用語） 寫" in fake_llm.bodies()[0]["messages"][0]["content"]


def test_a_social_post_is_asked_for_hashtags(fake_llm):
    fake_llm.reply("貼文")

    generate_output("social_post", SOURCE, model=platform_chat_model(), meter=None, platform="instagram")

    assert "最後放兩三個 hashtag" in fake_llm.bodies()[0]["messages"][0]["content"]
