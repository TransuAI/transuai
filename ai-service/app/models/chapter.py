import uuid

from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy import Integer, Numeric, String

from app.models.summary import Base

# Schema 對應 ../../infra/architecture-design.md 4.4 ai_db.chapters。


class Chapter(Base):
    __tablename__ = "chapters"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    job_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    start_time: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    sequence_no: Mapped[int] = mapped_column(Integer, nullable=False)
