import json
import logging
from dataclasses import dataclass

from app.services.llm_client import UsageSink, chat, platform_chat_model

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class TimedLine:
    """章節分段的一行輸入：開始時間（秒）與片段文字（多位講者時是「名稱：文字」，見 speaker_context）。"""

    start_time: float
    text: str

_PROMPT_TEMPLATE = (
    "你是一個逐字稿章節分段助手。以下是帶時間戳記（秒）的逐字稿片段（多人對話時每個片段前面標了講者名稱），"
    "請依內容主題的轉換切出章節，每個章節給一個簡潔的繁體中文標題，"
    "以及該章節開始的時間（取最接近的片段時間，單位秒）。\n"
    "只回傳 JSON 陣列，不要 Markdown code fence、不要其他文字，"
    '每個元素格式為 {{"title": string, "start_time": number}}，依 start_time 由小到大排序：\n\n{segments}'
)


_MAX_TOKENS = 2048


def _format_lines(lines: list[TimedLine]) -> str:
    return "\n".join(f"[{line.start_time:.1f}] {line.text}" for line in lines)


def _parse_response(text: str) -> list[dict]:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`")
        if cleaned.startswith("json"):
            cleaned = cleaned[len("json"):]
        cleaned = cleaned.strip()
    return json.loads(cleaned)


def generate_chapters(lines: list[TimedLine], *, meter: UsageSink | None) -> list[tuple[str, float]]:
    """呼叫模型，依逐字稿片段的時間戳切出章節，回傳依 start_time 排序的
    (title, start_time) 清單。

    逐字稿沒有分段（例如太短）時直接回空清單，不呼叫模型；模型判斷只有單一主題、
    回空陣列時也回空清單——章節分段找不到章節不算錯誤，交給呼叫端決定要不要存。
    """
    if not lines:
        return []

    model = platform_chat_model()
    logger.info("calling %s (%s) for chapters, segment count=%d", model.provider, model.model, len(lines))
    result = chat(model, [{"role": "user", "content": _PROMPT_TEMPLATE.format(segments=_format_lines(lines))}],
                  max_tokens=_MAX_TOKENS, meter=meter)
    raw_chapters = _parse_response(result.text or "[]")
    chapters = [(str(item["title"]), float(item["start_time"])) for item in raw_chapters]
    chapters.sort(key=lambda chapter: chapter[1])
    return chapters
