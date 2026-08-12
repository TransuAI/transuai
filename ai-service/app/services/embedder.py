import logging

from app.core.config import settings
from app.services.hf_client import get_client

logger = logging.getLogger(__name__)


def embed_documents(texts: list[str]) -> list[list[float]]:
    """把逐字稿片段轉成向量，用於寫進 embeddings 表。"""
    if not texts:
        return []
    logger.info("calling HF Inference (%s) to embed %d document chunks",
                settings.hf_embedding_model, len(texts))
    vectors = get_client().feature_extraction(texts, model=settings.hf_embedding_model)
    # feature_extraction 回傳 numpy float32 陣列，轉成原生 float 才能安全存進 pgvector 欄位。
    return [[float(x) for x in vector] for vector in vectors]


def embed_query(text: str) -> list[float]:
    """把使用者的問題轉成向量，用於在 embeddings 表裡做相似度搜尋。

    bge-m3 是對稱設計，query 跟 document 都不用加任何 instruction 前綴（跟 e5/Qwen3-Embedding
    系列不同），這裡跟 embed_documents 一樣直接丟原文。包成一個元素的 list 送出去，確保回傳
    一定是二維陣列，不用另外處理 API 對單一字串輸入可能有的維度歧義。
    """
    logger.info("calling HF Inference (%s) to embed question", settings.hf_embedding_model)
    vectors = get_client().feature_extraction([text], model=settings.hf_embedding_model)
    return [float(x) for x in vectors[0]]
