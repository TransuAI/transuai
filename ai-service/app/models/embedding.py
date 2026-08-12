import uuid
from datetime import datetime, timezone

from pgvector.sqlalchemy import Vector
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy import Numeric, Text

from app.models.summary import Base

# Schema 對應 ../../infra/architecture-design.md 4.4 ai_db.embeddings。
# embedding model 用 HF Inference API 上的 Qwen/Qwen3-Embedding-0.6B（見
# app/services/embedder.py），輸出維度用滿模型支援的上限 1024 維（原本 Gemini/multilingual-e5
# 時代是 768 維，換 model 順便調整；SQLAlchemy create_all 不會 ALTER 既有欄位型別，換維度時
# 舊的 embeddings 表要整張 DROP 掉讓它用新 schema 重建，反正舊資料是別的模型算出來的向量，
# 維度就算沒變也不能跟新模型混用）。
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
    embedding: Mapped[list[float]] = mapped_column(Vector(1024), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        default=lambda: datetime.now(timezone.utc))
