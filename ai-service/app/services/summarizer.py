import logging

from app.core.config import settings
from app.services.hf_client import DISABLE_THINKING, get_client, strip_thinking

logger = logging.getLogger(__name__)

_PROMPT_TEMPLATE = (
    "你是一個逐字稿摘要助手。請閱讀以下逐字稿，用繁體中文寫一段簡潔的摘要，"
    "涵蓋主要主題與重點，不要逐句翻譯或條列逐字稿內容。"
    "如果每行前面標了講者名稱（「名稱：內容」），摘要要點出誰說了什麼、各自的立場：\n\n{transcript}"
)

_MAX_TOKENS = 2048


def summarize(transcript_text: str) -> str:
    """呼叫 HF Inference Providers，把逐字稿濃縮成一段摘要（輸入見 speaker_context.summary_input）。"""
    logger.info("calling HF Inference (%s) for summary, transcript length=%d",
                settings.ai_hf_chat_model, len(transcript_text))
    response = get_client().chat.completions.create(
        model=settings.ai_hf_chat_model,
        messages=[{"role": "user", "content": _PROMPT_TEMPLATE.format(transcript=transcript_text)}],
        max_tokens=_MAX_TOKENS,
        extra_body=DISABLE_THINKING,
    )
    return strip_thinking(response.choices[0].message.content or "")
