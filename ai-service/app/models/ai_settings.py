from datetime import datetime

from sqlalchemy import DateTime, Integer, LargeBinary, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.summary import Base


class AiSettings(Base):
    """管理員在系統設定頁存的模型設定（只有一列，id 1）：平台模型、會後處理模型、embedding、網路搜尋。有這一列就用它，沒有就用
    環境變數（見 services/system_settings）。金鑰用 KEY_ENCRYPTION_KEY 加密（key_encryption，綁定欄位名稱）。"""

    __tablename__ = "ai_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    platform_base_url: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    platform_api_key: Mapped[bytes | None] = mapped_column(LargeBinary)
    platform_model: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    post_meeting_model: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    embedding_base_url: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    embedding_api_key: Mapped[bytes | None] = mapped_column(LargeBinary)
    embedding_model: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    embedding_query_instruction: Mapped[str] = mapped_column(Text, nullable=False, default="")
    web_search_api_key: Mapped[bytes | None] = mapped_column(LargeBinary)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
