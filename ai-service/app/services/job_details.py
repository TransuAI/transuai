"""標題與類型（見 .scratch/job-auto-title）：摘要產生之後，請模型依摘要與章節替 Job 取一個看得懂的標題、判斷類型，給 Job 列表用。
只是方便找檔案的附加功能：任何失敗都回 None，由呼叫端決定（pipeline 只記 log，Job 照樣完成）。"""

import logging
from dataclasses import dataclass

from app.services.chapter_generator import parse_json_reply
from app.services.llm_client import ChatModel, LlmError, chat
from app.services.segment_times import clock
from app.services.traditional_chinese import to_traditional
from app.services.usage_meter import UsageMeter

logger = logging.getLogger(__name__)

# 跟 upload-service 的 JobCategory 同一份清單；模型給了清單外的值就當「其他」。
CATEGORIES = ("meeting", "lecture", "interview", "podcast", "video", "other")
_MAX_TITLE_CHARS = 40
_MAX_TOKENS = 200

_PROMPT_TEMPLATE = (
    "以下是使用者上傳的一段內容（可能是會議、課程、訪談、Podcast、影片等）的摘要與章節。請替它取一個標題，並判斷它的類型，"
    "讓使用者在一長串檔案裡一眼認出是哪一個。\n"
    "標題：\n"
    "- 用台灣慣用的繁體中文，專有名詞（人名、公司、產品）保留原文；\n"
    f"- {_MAX_TITLE_CHARS} 字以內，寫出具體的主題（例如「GitLab 工程部 Key Review：KPI 調整與四部門拆分」），不要只寫「會議紀錄」；\n"
    "- 不要以「這場會議」「本影片」「關於」開頭，不要加引號或日期。\n"
    "類型（只能選一個）：meeting（會議）、lecture（課程、講座、教學）、interview（訪談）、podcast（Podcast、節目、對談）、"
    "video（其他影片）、other（其他）。\n"
    '只回傳 JSON，例如 {{"title": "...", "category": "meeting"}}，不要其他文字。\n\n'
    "## 摘要\n{summary}\n\n## 章節\n{chapters}"
)


@dataclass(frozen=True)
class JobDetails:
    title: str
    category: str


def suggest_details(summary: str, chapters: list[tuple[str, float]], *, model: ChatModel,
                    meter: UsageMeter) -> JobDetails | None:
    """依摘要與章節取標題、判斷類型；模型失敗或回的不是預期的 JSON 就是 None。"""
    chapter_lines = "\n".join(f"[{clock(start)}] {title}" for title, start in chapters) or "（沒有章節）"
    try:
        reply = chat(model, [{"role": "user", "content": _PROMPT_TEMPLATE.format(summary=summary, chapters=chapter_lines)}],
                     max_tokens=_MAX_TOKENS, meter=meter)
    except LlmError:
        logger.warning("could not ask for a title", exc_info=True)
        return None
    try:
        data = parse_json_reply(reply.text)
    except ValueError:
        # 只記長度：回覆是依摘要寫的，可能含錄音內容（ASVS 7.1.2）。
        logger.warning("the title answer is not JSON (%d characters)", len(reply.text))
        return None
    if not isinstance(data, dict) or not isinstance(data.get("title"), str):
        logger.warning("the title answer has no title (%s)", type(data).__name__)
        return None
    title = to_traditional(data["title"]).strip().strip("「」『』\"'“”").strip()[:_MAX_TITLE_CHARS].strip()
    if not title:
        return None
    category = data.get("category")
    return JobDetails(title=title, category=category if category in CATEGORIES else "other")
