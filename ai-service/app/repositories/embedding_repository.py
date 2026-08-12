import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Embedding


def save_embeddings(
    session: Session,
    job_id: uuid.UUID,
    chunks: list[tuple[str, float, float, list[float]]],
) -> list[Embedding]:
    """覆蓋寫入某個 job 的 embedding 列表：chunks 是 (chunk_text, start_time, end_time, vector)。

    跟 chapter_repository 一樣先刪除舊資料，避免重新處理時留下前一次的 embedding。
    """
    session.query(Embedding).filter(Embedding.job_id == job_id).delete()
    rows = [
        Embedding(job_id=job_id, chunk_text=chunk_text,
                   start_time=start_time, end_time=end_time, embedding=vector)
        for chunk_text, start_time, end_time, vector in chunks
    ]
    session.add_all(rows)
    session.commit()
    return rows


def find_similar(
    session: Session, job_id: uuid.UUID, query_vector: list[float], limit: int = 5
) -> list[Embedding]:
    """依 cosine distance 由近到遠取這個 job 前 limit 筆 embedding，沒有資料回空列表。"""
    return list(
        session.scalars(
            select(Embedding)
            .where(Embedding.job_id == job_id)
            .order_by(Embedding.embedding.cosine_distance(query_vector))
            .limit(limit)
        )
    )
