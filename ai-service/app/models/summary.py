import uuid
from datetime import datetime, timezone

from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy import Text

# Schema 對應 ../architecture-design.md 4.4 ai_db.summaries。
# MVP 階段用 create_all 自動建表，跟 upload-service/transcription-service 一致，
# 團隊/流量成長後再導入 Alembic 做版本化 migration。
#
# 文件裡 ai_db 還定義了 embeddings/qa_history/export_outputs，
# 但 MVP 目前只做「消費 transcription.completed -> 摘要」這條最短路徑，
# 那幾張表對應的功能（RAG 問答、多格式輸出）還沒做，先不建不用的表。
# chapters 表見 chapter.py（章節分段功能開發中）。


class Base(DeclarativeBase):
    pass


class Summary(Base):
    __tablename__ = "summaries"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    job_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), nullable=False, unique=True, index=True)
    summary_text: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        default=lambda: datetime.now(timezone.utc))
