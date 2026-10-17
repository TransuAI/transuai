import uuid
from datetime import datetime

from sqlalchemy import DateTime
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.summary import Base


class DeletedJob(Base):
    """upload-service 刪掉的 Job（收到 `job.deleted` 時記下，保留一天）：刪除之後才寫進來的資料要丟掉（見 services/job_deletion）。"""

    __tablename__ = "deleted_jobs"

    job_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    deleted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
