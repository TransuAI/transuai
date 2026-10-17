"""Embedding：把逐字稿片段、決策與問題轉成向量，走 OpenAI 相容的 /v1/embeddings（本地自架的 vLLM，或任何相容的伺服器，見
docs/adr/0015）。沒設定（EMBEDDING_BASE_URL、EMBEDDING_MODEL）時不算向量，呼叫端各自退回不用向量的做法。

錯誤一律轉成 EmbeddingError：暫時性的（429、5xx、逾時、連不上）交給既有的訊息層級重試（retry.py），client 自己不重試。
"""

import logging

import httpx2
import openai
from openai import OpenAI

from app.core import outbound
from app.core.config import settings

logger = logging.getLogger(__name__)

# 向量欄位的維度（embeddings.embedding、decisions.embedding 都是 Vector(1024)）。
DIMENSIONS = 1024

# 一次送幾段：一小時的逐字稿有好幾百段，分批送，單一請求不會太大。
_BATCH_SIZE = 64

# 自架的 vLLM 沒開 --api-key 時不檢查金鑰，但 openai SDK 不收空的金鑰。
_NO_KEY = "not-needed"

# 測試會換掉它（見 tests/conftest.py 的 fake_embedder）。
_http_client = outbound.client(timeout=httpx2.Timeout(120.0, connect=10.0))


class EmbeddingError(Exception):
    """一次 embedding 呼叫失敗。transient＝值得重試（429、5xx、逾時、連不上）。"""

    def __init__(self, message: str, *, transient: bool):
        super().__init__(f"embedding（{_config().embedding_model}）{message}")
        self.transient = transient


def _config():
    from app.services import system_settings  # 設定頁存的優先（system_settings 用到資料庫，用到才載入）

    return system_settings.current()


def is_configured() -> bool:
    config = _config()
    return bool(config.embedding_base_url and config.embedding_model)


def embed_documents(texts: list[str]) -> list[list[float]]:
    """把逐字稿片段（或決策）轉成向量，寫進資料庫用。文件本身不加指示。"""
    if not texts:
        return []
    config = _config()
    logger.info("calling %s (%s) to embed %d texts", config.embedding_base_url, config.embedding_model, len(texts))
    vectors: list[list[float]] = []
    for start in range(0, len(texts), _BATCH_SIZE):
        vectors.extend(_embed(texts[start:start + _BATCH_SIZE]))
    return vectors


def embed_query(text: str) -> list[float]:
    """把使用者的問題轉成向量，在資料庫裡找相似的片段。instruction-aware 的模型（Qwen3-Embedding）在問題前面加上指示
    （EMBEDDING_QUERY_INSTRUCTION，照它的格式「Instruct: …\\nQuery:…」），對稱的模型（bge-m3）不用設。"""
    config = _config()
    instruction = config.embedding_query_instruction.strip()
    query = f"Instruct: {instruction}\nQuery:{text}" if instruction else text
    logger.info("calling %s (%s) to embed a question", config.embedding_base_url, config.embedding_model)
    return _embed([query])[0]


def _embed(texts: list[str]) -> list[list[float]]:
    if not is_configured():
        raise EmbeddingError("尚未設定（EMBEDDING_BASE_URL、EMBEDDING_MODEL）", transient=False)
    config = _config()
    client = OpenAI(base_url=config.embedding_base_url, api_key=config.embedding_api_key or _NO_KEY,
                    http_client=_http_client, max_retries=0)
    try:
        response = client.embeddings.create(model=config.embedding_model, input=texts, encoding_format="float")
    except openai.APIConnectionError as exc:  # 也涵蓋逾時
        raise EmbeddingError(f"連不上：{exc}", transient=True) from exc
    except openai.APIStatusError as exc:
        transient = exc.status_code == 429 or exc.status_code >= 500
        raise EmbeddingError(f"失敗：HTTP {exc.status_code}", transient=transient) from exc
    except openai.APIError as exc:
        raise EmbeddingError(f"失敗：{exc}", transient=False) from exc
    vectors = [[float(x) for x in item.embedding] for item in sorted(response.data, key=lambda item: item.index)]
    if len(vectors) != len(texts):
        raise EmbeddingError(f"回傳了 {len(vectors)} 個向量，送出的是 {len(texts)} 段", transient=False)
    if vectors and len(vectors[0]) != DIMENSIONS:
        # 換成別的維度要改資料表（見 app/models/embedding.py），不能直接存。
        raise EmbeddingError(f"輸出 {len(vectors[0])} 維，資料庫的向量欄位是 {DIMENSIONS} 維", transient=False)
    return vectors
