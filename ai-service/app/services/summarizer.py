import logging

from app.services.llm_client import chat, platform_chat_model

logger = logging.getLogger(__name__)

_PROMPT_TEMPLATE = (
    "你是一個逐字稿摘要助手。請閱讀以下逐字稿，用繁體中文寫一段簡潔的摘要，"
    "涵蓋主要主題與重點，不要逐句翻譯或條列逐字稿內容。"
    "如果每行前面標了講者名稱（「名稱：內容」），摘要要點出誰說了什麼、各自的立場：\n\n{transcript}"
)

_MAX_TOKENS = 2048


def summarize(transcript_text: str) -> str:
    """呼叫模型，把逐字稿濃縮成一段摘要（輸入見 speaker_context.summary_input）。"""
    model = platform_chat_model()
    logger.info("calling %s (%s) for summary, transcript length=%d", model.provider, model.model, len(transcript_text))
    result = chat(model, [{"role": "user", "content": _PROMPT_TEMPLATE.format(transcript=transcript_text)}],
                  max_tokens=_MAX_TOKENS)
    return result.text
