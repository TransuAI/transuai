import uuid
from datetime import datetime, timezone
from enum import StrEnum

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.summary import Base

# 譯文（見 CONTEXT.md「譯文」）：一個 Job 的逐字稿翻成某一種語言，每個片段一句，跟原文片段一一對應（保留時間與講者）。一個 Job 每種語言
# 一筆；片段的譯文記著翻的時候的原文，原文被編輯過就知道要重翻。


class TranslationStatus(StrEnum):
    GENERATING = "GENERATING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"


class Translation(Base):
    __tablename__ = "translations"
    __table_args__ = (UniqueConstraint("job_id", "language"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    job_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    language: Mapped[str] = mapped_column(String(8), nullable=False)
    # 最近一次要求翻譯的使用者：用他的預設模型、用量記在他名下（編輯後的重翻也是）。
    requested_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    status: Mapped[str] = mapped_column(String(10), nullable=False)
    failure_reason: Mapped[str | None] = mapped_column(Text)
    # 這次要翻的片段數（有內容的片段），算進度用。
    total_segments: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    model_provider: Mapped[str | None] = mapped_column(String(32))
    model: Mapped[str | None] = mapped_column(String(200))
    requested_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # 上一批存檔的時間：翻得久的還在進展就不算卡住（見 translations.effective_status）。
    progressed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class SegmentTranslation(Base):
    __tablename__ = "segment_translations"
    __table_args__ = (UniqueConstraint("translation_id", "segment_id"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    translation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("translations.id", ondelete="CASCADE"), nullable=False, index=True)
    # transcription-service 的片段 id
    segment_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    # 翻的時候的原文：跟片段目前的文字不一樣就要重翻。
    source_text: Mapped[str] = mapped_column(Text, nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
