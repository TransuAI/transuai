import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Integer, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.summary import Base

# 用量（見 CONTEXT.md「用量」）：每一次 LLM 呼叫一筆，記在發起呼叫的使用者與 Job 名下。轉錄用量存在
# transcription-service，要顯示時由 Gateway 合併（見 CONTEXT-MAP.md）。


class LlmUsage(Base):
    __tablename__ = "llm_usage"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # 升級當下還在佇列裡、沒帶 userId 的舊訊息，使用者是空的。
    user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), index=True)
    job_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    # summary / chapters / qa_answer / qa_rewrite / regenerated_summary / regenerated_chapters
    feature: Mapped[str] = mapped_column(String(32), nullable=False)
    provider: Mapped[str] = mapped_column(String(32), nullable=False)
    model: Mapped[str] = mapped_column(String(200), nullable=False)
    key_source: Mapped[str] = mapped_column(String(16), nullable=False)  # platform / own_key
    # 廠商沒回報時是 NULL（未知），不是 0。
    input_tokens: Mapped[int | None] = mapped_column(Integer)
    output_tokens: Mapped[int | None] = mapped_column(Integer)
    succeeded: Mapped[bool] = mapped_column(Boolean, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))
