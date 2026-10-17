from functools import lru_cache

import httpx
from huggingface_hub import InferenceClient, set_client_factory
from huggingface_hub.utils._http import default_client_factory

from app.core import outbound
from app.core.config import settings


# huggingface_hub 底層用 httpx：它建的 client 也要經過對外連線的允許清單（保留它自己的 hook，再加上我們的）。
def _client_through_the_allowlist() -> httpx.Client:
    client = default_client_factory()
    client.event_hooks["request"] = [*client.event_hooks["request"], outbound.check]
    return client


set_client_factory(_client_through_the_allowlist)


@lru_cache(maxsize=1)
def get_client() -> InferenceClient:
    # 延遲到第一次真的呼叫才建立 client，避免 HF_API_KEY 還沒填時服務一啟動就噴錯，
    # 連 gRPC health check 都起不來。只剩 embedding（feature_extraction）用它；生成類呼叫
    # 走 OpenAI 相容介面（見 llm_client.py）。沒指定 provider，讓 HF 自動挑當下有 live 的
    # provider（見 docs/adr/0003-hf-inference-providers-for-generation.md）。
    return InferenceClient(api_key=settings.hf_api_key)
