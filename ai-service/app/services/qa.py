import logging
import uuid

from sqlalchemy.orm import Session

from app.core.config import settings
from app.repositories.embedding_repository import find_similar
from app.services.embedder import embed_query
from app.services.gemini_client import get_client

logger = logging.getLogger(__name__)

_PROMPT_TEMPLATE = (
    "你是一個逐字稿問答助手。請只根據以下逐字稿片段回答問題，用繁體中文回答；"
    "如果片段中找不到答案，就照實說沒有足夠資訊，不要編造：\n\n{context}\n\n問題：{question}"
)

_TOP_K = 5


class NoEmbeddingsError(Exception):
    """這個 job 還沒有任何 embedding（pipeline 還沒跑完，或逐字稿沒有分段）。"""


def answer_question(session: Session, job_id: uuid.UUID, question: str) -> tuple[str, list[float]]:
    """RAG 問答：把問題 embed 後找最相關的逐字稿片段，餵給 Gemini 生成回答。

    回傳 (answer, source_timestamps)，source_timestamps 是拿來回答的片段的起始時間，
    給前端做時間戳跳轉用，沒有特定排序保證。
    """
    query_vector = embed_query(question)
    chunks = find_similar(session, job_id, query_vector, limit=_TOP_K)
    if not chunks:
        raise NoEmbeddingsError(f"no embeddings found for job {job_id}")

    context = "\n\n".join(
        f"[{float(chunk.start_time):.1f}s] {chunk.chunk_text}" for chunk in chunks
    )
    logger.info("calling Gemini (%s) to answer question for job %s, using %d chunks",
                settings.gemini_model, job_id, len(chunks))
    response = get_client().models.generate_content(
        model=settings.gemini_model,
        contents=_PROMPT_TEMPLATE.format(context=context, question=question),
    )
    answer = (response.text or "").strip()
    source_timestamps = [float(chunk.start_time) for chunk in chunks]
    return answer, source_timestamps
