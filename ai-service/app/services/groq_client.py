import re
from functools import lru_cache

from groq import Groq

from app.core.config import settings

_THINK_BLOCK = re.compile(r"<think>.*?</think>", re.DOTALL)


@lru_cache(maxsize=1)
def get_client() -> Groq:
    # 延遲到第一次真的呼叫才建立 client，避免 GROQ_API_KEY 還沒填時
    # 服務一啟動（import 這個模組）就直接噴錯，連 gRPC health check 都起不來。
    return Groq(api_key=settings.groq_api_key)


def strip_thinking(text: str) -> str:
    """去掉 reasoning model（如 qwen/qwen3.6-27b）輸出裡的 <think>...</think> chain-of-thought。

    呼叫端已經傳了 reasoning_format="hidden"，但這個 preview 模型實測沒有照做，
    content 裡還是混著完整的思考過程，只能自己在這裡濾掉，不能只靠 API 參數。
    """
    return _THINK_BLOCK.sub("", text).strip()
