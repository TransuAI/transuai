import uuid
from datetime import datetime, timezone

from sqlalchemy import ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

# Schema 對應 infra/architecture-design.md 4.3 transcription_db。改了這裡的欄位要一起新增 Alembic
# migration（app/db/migrations，見 README「資料庫 migration」），服務啟動時才會套用到資料庫。


class Base(DeclarativeBase):
    pass


class Transcript(Base):
    __tablename__ = "transcripts"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    job_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), nullable=False, index=True)
    language: Mapped[str | None] = mapped_column(String(10))
    full_text: Mapped[str | None] = mapped_column(Text)
    # 每次實際改動逐字稿（編輯）就 +1。目的是讓 AI 產出記錄自己依據的版本、比對出是否過時。
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(
        default=lambda: datetime.now(timezone.utc))

    segments: Mapped[list["TranscriptSegment"]] = relationship(
        back_populates="transcript",
        cascade="all, delete-orphan",
        order_by="TranscriptSegment.sequence_no",
    )


class TranscriptSegment(Base):
    __tablename__ = "transcript_segments"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    transcript_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("transcripts.id", ondelete="CASCADE"), nullable=False
    )
    start_time: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    end_time: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    speaker_label: Mapped[str | None] = mapped_column(
        String(50))  # 講者分離功能預留欄位，MVP 先不啟用
    # 目前的文字；空字串＝已清空片段（見 CONTEXT.md）。
    text: Mapped[str] = mapped_column(Text, nullable=False)
    # 人工編輯前的機器產出（原始文字），永遠不變，供還原使用。
    original_text: Mapped[str] = mapped_column(Text, nullable=False)
    sequence_no: Mapped[int] = mapped_column(Integer, nullable=False)

    transcript: Mapped["Transcript"] = relationship(back_populates="segments")
