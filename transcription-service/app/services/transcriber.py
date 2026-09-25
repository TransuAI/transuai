import logging
from dataclasses import dataclass
from pathlib import Path

from groq import Groq

from app.core.config import settings

logger = logging.getLogger(__name__)

_client = Groq(api_key=settings.groq_api_key)


@dataclass
class TranscriptSegment:
    start: float
    end: float
    text: str


@dataclass
class TranscriptResult:
    language: str
    full_text: str
    segments: list[TranscriptSegment]


def transcribe(audio_path: Path) -> TranscriptResult:
    """呼叫 Groq Whisper API，回傳含片段 timestamp 的逐字稿。"""
    logger.info("calling Groq Whisper (%s) for %s", settings.groq_model, audio_path)
    with audio_path.open("rb") as f:
        response = _client.audio.transcriptions.create(
            file=(audio_path.name, f.read()),
            model=settings.groq_model,
            response_format="verbose_json",
            timestamp_granularities=["segment"],
        )

    # verbose_json 回傳的 language/segments 不在 SDK 的靜態型別裡（見 groq.types.audio.Transcription），
    # 但 groq 的 BaseModel 設定 extra="allow"，這些欄位仍會以動態屬性存在，用 getattr 保守存取。
    raw_segments = getattr(response, "segments", None) or []
    segments = [
        TranscriptSegment(start=float(seg["start"]), end=float(seg["end"]), text=seg["text"].strip())
        for seg in raw_segments
    ]

    return TranscriptResult(
        language=getattr(response, "language", "") or "",
        full_text=response.text,
        segments=segments,
    )
