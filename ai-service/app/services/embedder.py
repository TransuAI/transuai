import logging

from app.services.gemini_client import get_client

logger = logging.getLogger(__name__)

_EMBEDDING_MODEL = "text-embedding-004"


def embed_documents(texts: list[str]) -> list[list[float]]:
    """把逐字稿片段轉成向量，用於寫進 embeddings 表。"""
    if not texts:
        return []
    logger.info("calling Gemini (%s) to embed %d document chunks", _EMBEDDING_MODEL, len(texts))
    response = get_client().models.embed_content(
        model=_EMBEDDING_MODEL,
        contents=texts,
        config={"task_type": "RETRIEVAL_DOCUMENT"},
    )
    return [embedding.values for embedding in response.embeddings]


def embed_query(text: str) -> list[float]:
    """把使用者的問題轉成向量，用於在 embeddings 表裡做相似度搜尋。"""
    logger.info("calling Gemini (%s) to embed question", _EMBEDDING_MODEL)
    response = get_client().models.embed_content(
        model=_EMBEDDING_MODEL,
        contents=[text],
        config={"task_type": "RETRIEVAL_QUERY"},
    )
    return response.embeddings[0].values
