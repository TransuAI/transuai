import uuid
from datetime import datetime, timezone

from sqlalchemy import ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

# Schema 對應 ../architecture-design.md 4.3 transcription_db。
# MVP 階段用 create_all 自動建表，跟 upload-service 的 Hibernate ddl-auto=update 一致，
# 團隊/流量成長後再導入 Alembic 做版本化 migration。


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
    text: Mapped[str] = mapped_column(Text, nullable=False)
    sequence_no: Mapped[int] = mapped_column(Integer, nullable=False)

    transcript: Mapped["Transcript"] = relationship(back_populates="segments")
