import uuid
from datetime import datetime, timezone
from enum import StrEnum

from sqlalchemy import DateTime, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.summary import Base

# 講者數據的 AI 判斷（見 .scratch/speaker-analytics、services/speaker_insights.py）：每位講者提出的問題、可能的打斷。一個 Job 一份，
# 再分析時同一份改回「分析中」，完成才換掉項目（分析中照樣看得到上一次的結果）。


class SpeakerInsightsStatus(StrEnum):
    GENERATING = "GENERATING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"


class SpeakerInsightRun(Base):
    __tablename__ = "speaker_insights"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    job_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, unique=True)
    # 最近一次要求分析的使用者：用他的預設模型、用量記在他名下。
    requested_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    status: Mapped[str] = mapped_column(String(10), nullable=False)
    failure_reason: Mapped[str | None] = mapped_column(Text)
    # 上一次完成的依據 revision 與模型；還沒完成過是空的。
    source_revision: Mapped[int | None] = mapped_column(Integer)
    model_provider: Mapped[str | None] = mapped_column(String(32))
    model: Mapped[str | None] = mapped_column(String(200))
    requested_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class SpeakerInsightItem(Base):
    __tablename__ = "speaker_insight_items"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    run_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("speaker_insights.id", ondelete="CASCADE"), nullable=False, index=True)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)  # question / interruption
    speaker_label: Mapped[str] = mapped_column(String(32), nullable=False)
    interrupted_label: Mapped[str | None] = mapped_column(String(32))
    start_time: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
