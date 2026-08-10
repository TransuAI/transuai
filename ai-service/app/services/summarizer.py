import logging
from functools import lru_cache

from google import genai

from app.core.config import settings

logger = logging.getLogger(__name__)

_PROMPT_TEMPLATE = (
    "你是一個逐字稿摘要助手。請閱讀以下逐字稿，用繁體中文寫一段簡潔的摘要，"
    "涵蓋主要主題與重點，不要逐句翻譯或條列逐字稿內容：\n\n{transcript}"
)


@lru_cache(maxsize=1)
def _client() -> genai.Client:
    # 延遲到第一次真的呼叫才建立 client，避免 GEMINI_API_KEY 還沒填時
    # 服務一啟動（import 這個模組）就直接噴錯，連 gRPC health check 都起不來。
    return genai.Client(api_key=settings.gemini_api_key)


def summarize(full_text: str) -> str:
    """呼叫 Gemini API，把逐字稿全文濃縮成一段摘要。"""
    logger.info("calling Gemini (%s) for summary, transcript length=%d",
                settings.gemini_model, len(full_text))
    response = _client().models.generate_content(
        model=settings.gemini_model,
        contents=_PROMPT_TEMPLATE.format(transcript=full_text),
    )
    return (response.text or "").strip()
