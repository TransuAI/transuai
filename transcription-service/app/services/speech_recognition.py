"""語音辨識 adapter：把音檔交給語音辨識服務，回傳不綁定廠商的逐字資料（偵測到的語言 + 每個字的起訖時間、
含標點的文字、廠商給的原始講者標籤）。之後的切片段、講者編號都只看這個格式（見 app/services/segmentation.py），
換廠商只需要換這個模組。

目前用 Deepgram Nova-3，一次呼叫同時完成轉錄和講者分離；為什麼不是 Groq Whisper 見
docs/adr/0001-deepgram-replaces-groq-for-transcription-and-diarization.md。
"""

import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class RecognizedWord:
    start: float
    end: float
    text: str  # 含標點
    speaker: str | None  # 廠商給的原始講者標籤；沒有講者資訊時是 None


@dataclass(frozen=True)
class Recognition:
    language: str
    words: list[RecognizedWord]
    # 服務計費的音檔長度（轉錄用量）；服務沒回報時是 None。
    audio_seconds: float | None = None


_DEEPGRAM_URL = "https://api.deepgram.com/v1/listen"
PROVIDER = "deepgram"


def model_name() -> str:
    """目前用的語音辨識模型（記轉錄用量用）。"""
    return settings.deepgram_model

# 音檔直接以檔案內容上傳（不傳 URL：本機的 MinIO 從網際網路上連不到）。幾十分鐘的音檔上傳加處理要一點時間，
# 讀取逾時放寬；連不上則很快放棄，交給訊息層級重試。
_client = httpx.Client(timeout=httpx.Timeout(600.0, connect=10.0))


def recognize(audio_path: Path) -> Recognition:
    """轉錄並做講者分離。HTTP 錯誤一律 raise（暫時性與否由 is_transient_recognition_error() 判斷）。"""
    logger.info("calling Deepgram (%s, %s) for %s", settings.deepgram_model, settings.deepgram_language, audio_path)
    with audio_path.open("rb") as audio:
        response = _client.post(
            _DEEPGRAM_URL,
            params={
                "model": settings.deepgram_model,
                "language": settings.deepgram_language,
                "diarize": "true",
                "smart_format": "true",
                "punctuate": "true",
            },
            headers={
                "Authorization": f"Token {settings.deepgram_api_key}",
                # Deepgram 自己從內容判斷音訊格式，AUDIO 上傳的原始檔跟 VIDEO 抽出來的音軌格式不一定相同。
                "Content-Type": "application/octet-stream",
            },
            content=audio,
        )
    response.raise_for_status()
    return _parse(response.json())


def _parse(body: dict[str, Any]) -> Recognition:
    channel = body["results"]["channels"][0]
    words = [
        RecognizedWord(
            start=float(word["start"]),
            end=float(word["end"]),
            text=word.get("punctuated_word") or word["word"],
            speaker=str(word["speaker"]) if word.get("speaker") is not None else None,
        )
        for word in channel["alternatives"][0]["words"]
    ]
    # 指定語言時 Deepgram 不回 detected_language，這時就是指定的語言。
    duration = body.get("metadata", {}).get("duration")
    return Recognition(
        language=channel.get("detected_language") or settings.deepgram_language,
        words=words,
        audio_seconds=float(duration) if duration is not None else None,
    )


def is_transient_recognition_error(exc: BaseException) -> bool:
    """429、5xx、逾時與連線問題算暫時性失敗（值得重試）；其他 HTTP 錯誤（壞檔、認證、額度用完的 402…）
    和非 HTTP 例外都是永久性失敗。"""
    if isinstance(exc, httpx.HTTPStatusError):
        status = exc.response.status_code
        return status == 429 or status >= 500
    return isinstance(exc, httpx.TransportError)
