from datetime import datetime

from sqlalchemy import DateTime, Float, Integer, LargeBinary, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.transcript import Base


class SpeechSettings(Base):
    """管理員在系統設定頁存的語音辨識設定（只有一列，id 1）。有這一列就用它，沒有就用環境變數（見 services/speech_settings）。
    金鑰用 KEY_ENCRYPTION_KEY 加密。"""

    __tablename__ = "speech_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    stt_base_url: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    stt_api_key: Mapped[bytes | None] = mapped_column(LargeBinary)
    stt_model: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    deepgram_api_key: Mapped[bytes | None] = mapped_column(LargeBinary)
    diarization_threshold: Mapped[float] = mapped_column(Float, nullable=False, default=0.6)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
