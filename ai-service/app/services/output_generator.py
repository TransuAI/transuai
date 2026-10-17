"""多格式輸出（見 CONTEXT.md「多格式輸出」、.scratch/multi-format-outputs）：依一個 Job 的摘要、章節與講者，請模型寫成某種要發出去的文件
（Markdown）。每種格式一份 prompt。

時間戳一律從章節來：模型不寫時間（prompt 這樣要求，寫了也會被刪掉——開頭是時間的那幾行整行刪除），需要章節的格式由程式在最後附上真的
章節時間。語言跟著內容（中文用台灣繁體；整份回覆是簡體時轉成繁體）。"""

import re
from dataclasses import dataclass

from app.services.llm_client import ChatModel, UsageSink, chat
from app.services.segment_times import clock
from app.services.traditional_chinese import to_traditional

_MAX_TOKENS = 4096

# 一行開頭是時間（可能在清單符號後、可能包在中括號裡）：模型自己寫的時間，整行不要。
_TIMESTAMP_LINE = re.compile(r"^\s*(?:[-*•]\s*)?\[?\d{1,2}:\d{2}(?::\d{2})?\]?(?:\s|$)")


@dataclass(frozen=True)
class OutputSource:
    """產生需要的內容：標題（沒有是空字串）、摘要、章節（標題, 開始秒數）、講者名稱（兩位以上講者時才有）、使用者的一句要求。"""

    title: str
    summary: str
    chapters: list[tuple[str, float]]
    speakers: list[str]
    instruction: str = ""
    # 逐字稿的語言：en 是英文，其他（zh-TW、舊資料的 Chinese）當中文。輸出跟著它寫，不是跟著摘要（摘要一律是中文）。
    language: str = "zh-TW"

    @property
    def writes_english(self) -> bool:
        return self.language.lower().startswith("en")


class OutputFormatError(Exception):
    """模型回的內容不能用（空的）。"""


@dataclass(frozen=True)
class _Format:
    instructions: str
    # 最後附上章節清單（標題前面是時間）
    with_chapters: bool
    # YouTube 要第一個章節是 0:00 才會把清單認成影片章節。
    chapters_from_zero: bool = False


@dataclass(frozen=True)
class SocialPlatform:
    name: str
    # 平台的字數上限（X 的中日韓字算兩個，上限 280 等於約 140 個中文字；前端照同樣的算法顯示字數）
    limit: int
    guidance: str


SOCIAL_PLATFORMS: dict[str, SocialPlatform] = {
    "threads": SocialPlatform("Threads", 500, "口語、像在跟朋友聊天，一兩段就好，可以用一個問題收尾引人回覆"),
    "facebook": SocialPlatform("Facebook", 63206, "150 到 300 字，第一句要抓住注意力，分段好讀"),
    "instagram": SocialPlatform("Instagram", 2200, "100 到 200 字，第一句是重點（後面會被摺疊），可以用少量 emoji"),
    "linkedin": SocialPlatform("LinkedIn", 3000, "專業但不生硬，150 到 300 字，分享一個觀點或學到的事"),
    "x": SocialPlatform("X", 280, "一則推文：中文 120 字以內（英文 260 字元以內），一個重點"),
}


_COMMON = (
    "寫作規則：\n"
    "- 請用 {language} 寫（下面的內容是中文時也一樣）；用自然、道地的說法，不要像翻譯。\n"
    "- 只根據下面的內容寫，不要編造內容裡沒有的事實、數字、人名或來賓頭銜。\n"
    "- 不要寫時間或時間戳（章節時間會由系統另外附上），不要提「逐字稿」「摘要」「錄音」。\n"
    "- 直接輸出文件本身（Markdown），不要加「以下是…」這類開場白，也不要包在 code block 裡。\n"
)

FORMATS: dict[str, _Format] = {
    "podcast_description": _Format(
        "請替這一集節目寫 Podcast 節目介紹（貼在 Podcast 平台的節目說明欄）：\n"
        "- 第一行是一句話簡介，說這一集在談什麼，吸引人點開來聽。\n"
        "- 接著一兩句補充聽眾可以得到什麼。\n"
        "- 接著「重點」清單，三到五點，每點一句。\n"
        "- 有來賓或多位講者時，可以一句話介紹誰參與了這一集（只用內容裡出現的名字）。\n"
        "- 全文 150 到 300 字（英文 100 到 200 words）。\n",
        with_chapters=True,
    ),
    "youtube_description": _Format(
        "請替這支影片寫 YouTube 影片說明欄：\n"
        "- 前兩行（約 100 字）是最重要的簡介：在搜尋結果與摺疊前就看得到，要讓人想點開。\n"
        "- 接著一段補充影片內容（兩三句）。\n"
        "- 最後一行放三到五個跟內容相關的 hashtag。\n",
        with_chapters=True,
        chapters_from_zero=True,
    ),
    "blog_post": _Format(
        "請把這段內容寫成一篇部落格文章：\n"
        "- 第一行是文章標題（Markdown 一級標題 #）。\n"
        "- 開頭一段說明這篇在談什麼、為什麼值得讀。\n"
        "- 內文依主題分成幾個小節，每節用二級標題（##），段落完整、有前後連貫，不是條列重點。\n"
        "- 最後一段做總結或給讀者的建議。\n"
        "- 全文 800 到 1500 字（英文 500 到 1000 words）。\n",
        with_chapters=False,
    ),
    "newsletter": _Format(
        "請把這段內容寫成一期電子報：\n"
        "- 第一行是這期的標題（Markdown 一級標題 #）。\n"
        "- 開頭兩三句跟讀者打招呼、帶出這期主題。\n"
        "- 三到五個重點，每點一個粗體小標加兩三句說明。\n"
        "- 最後一段是行動呼籲（例如收聽完整內容、回信分享想法）。\n"
        "- 全文 300 到 600 字（英文 200 到 400 words）。\n",
        with_chapters=False,
    ),
    "social_post": _Format(
        "請替這段內容寫一則 {platform} 貼文：\n"
        "- {guidance}。\n"
        "- 字數絕對不能超過 {platform} 的上限 {limit} 字元。\n"
        "- 最後放兩三個 hashtag（X 只放一個）。\n",
        with_chapters=False,
    ),
}


def generate_output(format_name: str, source: OutputSource, *, model: ChatModel, meter: UsageSink | None,
                    platform: str | None = None) -> str:
    """產生一份輸出的 Markdown。格式不認得、社群貼文沒有（或不認得）平台 raise ValueError（不呼叫模型）；模型回空的 raise
    OutputFormatError；模型呼叫失敗的例外照樣往外冒。"""
    if format_name not in FORMATS:
        raise ValueError(f"unknown output format: {format_name}")
    output_format = FORMATS[format_name]
    instructions = output_format.instructions
    if format_name == "social_post":
        if platform not in SOCIAL_PLATFORMS:
            raise ValueError(f"unknown social platform: {platform}")
        chosen = SOCIAL_PLATFORMS[platform]
        instructions = instructions.format(platform=chosen.name, guidance=chosen.guidance, limit=chosen.limit)
    prompt = _prompt(instructions, source)
    reply = chat(model, [{"role": "user", "content": prompt}], max_tokens=_MAX_TOKENS, meter=meter)
    text = reply.text if source.writes_english else to_traditional(reply.text)
    body = _without_times(text).strip()
    if not body:
        raise OutputFormatError("empty reply")
    if output_format.with_chapters and source.chapters:
        chapters = list(source.chapters)
        if output_format.chapters_from_zero:
            chapters[0] = (chapters[0][0], 0.0)
        body += "\n\n## 章節\n\n" + "\n".join(f"{clock(start)} {title}" for title, start in chapters)
    return body + "\n"


def _prompt(instructions: str, source: OutputSource) -> str:
    parts = [instructions, _COMMON.format(language="English" if source.writes_english else "繁體中文（台灣用語）")]
    if source.instruction:
        # The user's own request comes after the rules, but can't lift them (no made-up facts, no times).
        parts.append(f"使用者另外的要求（在不違反上面規則的前提下照做）：{source.instruction}\n")
    parts.append("內容：")
    if source.title:
        parts.append(f"標題：{source.title}")
    if source.speakers:
        parts.append(f"講者：{'、'.join(source.speakers)}")
    parts.append(f"摘要：\n{source.summary}")
    if source.chapters:
        parts.append("章節：\n" + "\n".join(f"- {title}" for title, _ in source.chapters))
    return "\n".join(parts)


def _without_times(text: str) -> str:
    lines = [line for line in text.splitlines() if not _TIMESTAMP_LINE.match(line)]
    # Dropping lines can leave runs of blank lines behind.
    return re.sub(r"\n{3,}", "\n\n", "\n".join(lines))
