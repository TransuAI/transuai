import uuid

from sqlalchemy import and_, exists, or_, select
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


def has_embeddings(session: Session, job_id: uuid.UUID) -> bool:
    """這個 job 有沒有任何 embedding（pipeline 跑完、逐字稿有分段）。"""
    return bool(session.scalar(select(exists().where(Embedding.job_id == job_id))))


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


def find_by_job_id(session: Session, job_id: uuid.UUID) -> list[Embedding]:
    return list(session.scalars(select(Embedding).where(Embedding.job_id == job_id)))


def apply_embedding_changes(
    session: Session,
    job_id: uuid.UUID,
    upserts: list[tuple[str, float, float, list[float]]],
    deletions: list[tuple[float, float]],
) -> None:
    """依片段的起訖時間（一個 job 內不會重複，編輯也不會改）替換 / 刪除個別片段的 embedding：upserts 是
    (chunk_text, start_time, end_time, vector)，deletions 是 (start_time, end_time)。"""
    keys = [(start, end) for _, start, end, _ in upserts] + deletions
    if keys:
        session.query(Embedding).filter(
            Embedding.job_id == job_id,
            or_(*(and_(Embedding.start_time == start, Embedding.end_time == end) for start, end in keys)),
        ).delete(synchronize_session=False)
    session.add_all(
        Embedding(job_id=job_id, chunk_text=text, start_time=start, end_time=end, embedding=vector)
        for text, start, end, vector in upserts
    )
    session.commit()
