from functools import lru_cache

from huggingface_hub import InferenceClient

from app.core.config import settings


@lru_cache(maxsize=1)
def get_client() -> InferenceClient:
    # 延遲到第一次真的呼叫才建立 client，理由同 groq_client：避免 HF_API_KEY 還沒填時
    # 服務一啟動就噴錯，連 gRPC health check 都起不來。
    return InferenceClient(api_key=settings.hf_api_key)
