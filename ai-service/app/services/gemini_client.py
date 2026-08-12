from functools import lru_cache

from google import genai

from app.core.config import settings


@lru_cache(maxsize=1)
def get_client() -> genai.Client:
    # 延遲到第一次真的呼叫才建立 client，避免 GEMINI_API_KEY 還沒填時
    # 服務一啟動（import 這個模組）就直接噴錯，連 gRPC health check 都起不來。
    return genai.Client(api_key=settings.gemini_api_key)
