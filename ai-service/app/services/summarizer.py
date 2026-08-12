import logging

from app.core.config import settings
from app.services.gemini_client import get_client

logger = logging.getLogger(__name__)

_PROMPT_TEMPLATE = (
    "你是一個逐字稿摘要助手。請閱讀以下逐字稿，用繁體中文寫一段簡潔的摘要，"
    "涵蓋主要主題與重點，不要逐句翻譯或條列逐字稿內容：\n\n{transcript}"
)


def summarize(full_text: str) -> str:
    """呼叫 Gemini API，把逐字稿全文濃縮成一段摘要。"""
    logger.info("calling Gemini (%s) for summary, transcript length=%d",
                settings.gemini_model, len(full_text))
    response = get_client().models.generate_content(
        model=settings.gemini_model,
        contents=_PROMPT_TEMPLATE.format(transcript=full_text),
    )
    return (response.text or "").strip()
