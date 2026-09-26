from functools import lru_cache

from huggingface_hub import InferenceClient

from app.core.config import settings


@lru_cache(maxsize=1)
def get_client() -> InferenceClient:
    # 延遲到第一次真的呼叫才建立 client，避免 HF_API_KEY 還沒填時服務一啟動就噴錯，
    # 連 gRPC health check 都起不來。只剩 embedding（feature_extraction）用它；生成類呼叫
    # 走 OpenAI 相容介面（見 llm_client.py）。沒指定 provider，讓 HF 自動挑當下有 live 的
    # provider（見 docs/adr/0003-hf-inference-providers-for-generation.md）。
    return InferenceClient(api_key=settings.hf_api_key)
