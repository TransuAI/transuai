import json
import logging

from app.core.config import settings
from app.proto_gen.transcription_pb2 import TranscriptSegment
from app.services.gemini_client import get_client

logger = logging.getLogger(__name__)

_PROMPT_TEMPLATE = (
    "你是一個逐字稿章節分段助手。以下是帶時間戳記（秒）的逐字稿分段，"
    "請依內容主題的轉換切出章節，每個章節給一個簡潔的繁體中文標題，"
    "以及該章節開始的時間（取最接近的分段時間，單位秒）。\n"
    "只回傳 JSON 陣列，不要 Markdown code fence、不要其他文字，"
    '每個元素格式為 {{"title": string, "start_time": number}}，依 start_time 由小到大排序：\n\n{segments}'
)


def _format_segments(segments: list[TranscriptSegment]) -> str:
    return "\n".join(f"[{segment.start_time:.1f}] {segment.text}" for segment in segments)


def _parse_response(text: str) -> list[dict]:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`")
        if cleaned.startswith("json"):
            cleaned = cleaned[len("json"):]
        cleaned = cleaned.strip()
    return json.loads(cleaned)


def generate_chapters(segments: list[TranscriptSegment]) -> list[tuple[str, float]]:
    """呼叫 Gemini，依逐字稿分段的時間戳切出章節，回傳依 start_time 排序的 (title, start_time) 清單。

    逐字稿沒有分段（例如太短）時直接回空清單，不呼叫 Gemini；模型判斷只有單一主題、
    回空陣列時也回空清單——章節分段找不到章節不算錯誤，交給呼叫端決定要不要存。
    """
    if not segments:
        return []

    logger.info("calling Gemini (%s) for chapters, segment count=%d",
                settings.gemini_model, len(segments))
    response = get_client().models.generate_content(
        model=settings.gemini_model,
        contents=_PROMPT_TEMPLATE.format(segments=_format_segments(segments)),
    )
    raw_chapters = _parse_response(response.text or "[]")
    chapters = [(str(item["title"]), float(item["start_time"])) for item in raw_chapters]
    chapters.sort(key=lambda chapter: chapter[1])
    return chapters
