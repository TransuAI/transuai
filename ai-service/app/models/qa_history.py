import uuid
from datetime import datetime, timezone

from sqlalchemy.dialects.postgresql import ARRAY, UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy import Numeric, Text

from app.models.summary import Base

# Schema 對應 ../../infra/architecture-design.md 4.4 ai_db.qa_history。
# 目前只寫入、沒有對應的查詢 RPC（architecture-design.md 3.4 也只規劃了 POST /qa/{jobId}），
# 純粹留作紀錄，之後要做「問答歷史」列表可以直接查這張表。


class QaHistory(Base):
    __tablename__ = "qa_history"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    job_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), nullable=False, index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    question: Mapped[str] = mapped_column(Text, nullable=False)
    answer: Mapped[str] = mapped_column(Text, nullable=False)
    source_timestamps: Mapped[list[float]] = mapped_column(ARRAY(Numeric(10, 2)))
    created_at: Mapped[datetime] = mapped_column(
        default=lambda: datetime.now(timezone.utc))
