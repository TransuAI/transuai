import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, Integer, Numeric, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.summary import Base

# 講者名字建議（見 CONTEXT.md）：pipeline 依錄音裡明確講出的話替還沒改名的講者提出的名字，附依據。建議是 AI 的產出，放 ai_db；
# 講者本身與改名在 transcription-service。一個 Job 的每位講者最多一筆。


class SpeakerSuggestion(Base):
    __tablename__ = "speaker_name_suggestions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    job_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False, index=True)
    speaker_label: Mapped[str] = mapped_column(String(32), nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    # 依據：那句話的片段開始時間與原文。
    evidence_start_time: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    evidence_text: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending")  # pending / applied / dismissed
    # 講者的順序（講者 1、講者 2…）：列出時照這個排。
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc))
