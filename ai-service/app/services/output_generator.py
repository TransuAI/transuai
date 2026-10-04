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


class OutputFormatError(Exception):
    """模型回的內容不能用（空的）。"""


@dataclass(frozen=True)
class _Format:
    instructions: str
    # 最後附上章節清單（標題前面是時間）
    with_chapters: bool


_COMMON = (
    "寫作規則：\n"
    "- 用跟內容相同的語言寫；中文用台灣慣用、自然的繁體中文。\n"
    "- 只根據下面的內容寫，不要編造內容裡沒有的事實、數字、人名或來賓頭銜。\n"
    "- 不要寫時間或時間戳（章節時間會由系統另外附上），不要提「逐字稿」「摘要」「錄音」。\n"
    "- 直接輸出文件本身（Markdown），不要加「以下是…」這類開場白，也不要包在 code block 裡。\n"
)

FORMATS: dict[str, _Format] = {
    "podcast_description": _Format(
        "請替這一集節目寫 Podcast 節目介紹（貼在 Podcast 平台的節目說明欄）：\n"
        "- 第一段兩三句，說這一集在談什麼、聽眾可以得到什麼，吸引人點開來聽。\n"
        "- 接著「重點」清單，三到五點，每點一句。\n"
        "- 有來賓或多位講者時，可以一句話介紹誰參與了這一集（只用內容裡出現的名字）。\n"
        "- 全文 150 到 300 字（英文 100 到 200 words）。\n",
        with_chapters=True,
    ),
}


def generate_output(format_name: str, source: OutputSource, *, model: ChatModel, meter: UsageSink | None) -> str:
    """產生一份輸出的 Markdown。格式不認得 raise ValueError（不呼叫模型）；模型回空的 raise OutputFormatError；模型呼叫失敗的例外照樣往外冒。"""
    if format_name not in FORMATS:
        raise ValueError(f"unknown output format: {format_name}")
    output_format = FORMATS[format_name]
    reply = chat(model, [{"role": "user", "content": _prompt(output_format, source)}], max_tokens=_MAX_TOKENS, meter=meter)
    body = _without_times(to_traditional(reply.text)).strip()
    if not body:
        raise OutputFormatError("empty reply")
    if output_format.with_chapters and source.chapters:
        body += "\n\n## 章節\n\n" + "\n".join(f"{clock(start)} {title}" for title, start in source.chapters)
    return body + "\n"


def _prompt(output_format: _Format, source: OutputSource) -> str:
    parts = [output_format.instructions, _COMMON]
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
