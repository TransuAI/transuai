import uuid
from datetime import datetime, timezone

from pgvector.sqlalchemy import Vector
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy import Numeric, Text

from app.models.summary import Base

# Schema 對應 ../../infra/architecture-design.md 4.4 ai_db.embeddings。
# embedding model 用 Gemini text-embedding-004（見 app/services/embedder.py），輸出維度剛好是
# 文件原本規劃的 768 維，不用另外調整欄位。
#
# 文件裡的 idx_embeddings_vector（ivfflat）沒有建：ivfflat 需要先有資料才能訓練聚類、還要調
# lists 參數，MVP 資料量小、查詢一定先用 job_id 過濾縮小範圍，先不做這層索引優化。


class Embedding(Base):
    __tablename__ = "embeddings"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    job_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), nullable=False, index=True)
    chunk_text: Mapped[str] = mapped_column(Text, nullable=False)
    start_time: Mapped[float | None] = mapped_column(Numeric(10, 2))
    end_time: Mapped[float | None] = mapped_column(Numeric(10, 2))
    embedding: Mapped[list[float]] = mapped_column(Vector(768), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        default=lambda: datetime.now(timezone.utc))
