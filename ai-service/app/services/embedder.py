import logging

from app.services.gemini_client import get_client

logger = logging.getLogger(__name__)

_EMBEDDING_MODEL = "gemini-embedding-001"
# text-embedding-004 是文件（architecture-design.md 8.5）原本假設的模型，但已經從 v1beta 下架
# （embed_content 呼叫會直接 404），改用目前可用的 gemini-embedding-001。它預設輸出 3072 維，
# 這裡用 output_dimensionality 截斷成 768 維，對齊 schema 的 Vector(768) 欄位，
# 文件（docs）跟查詢（query）兩邊要用同一個維度，cosine similarity 才有意義。
_OUTPUT_DIMENSIONALITY = 768


def embed_documents(texts: list[str]) -> list[list[float]]:
    """把逐字稿片段轉成向量，用於寫進 embeddings 表。"""
    if not texts:
        return []
    logger.info("calling Gemini (%s) to embed %d document chunks", _EMBEDDING_MODEL, len(texts))
    response = get_client().models.embed_content(
        model=_EMBEDDING_MODEL,
        contents=texts,
        config={"task_type": "RETRIEVAL_DOCUMENT", "output_dimensionality": _OUTPUT_DIMENSIONALITY},
    )
    return [embedding.values for embedding in response.embeddings]


def embed_query(text: str) -> list[float]:
    """把使用者的問題轉成向量，用於在 embeddings 表裡做相似度搜尋。"""
    logger.info("calling Gemini (%s) to embed question", _EMBEDDING_MODEL)
    response = get_client().models.embed_content(
        model=_EMBEDDING_MODEL,
        contents=[text],
        config={"task_type": "RETRIEVAL_QUERY", "output_dimensionality": _OUTPUT_DIMENSIONALITY},
    )
    return response.embeddings[0].values
