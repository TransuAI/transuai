"""語音辨識 adapter：把音檔交給語音辨識服務，回傳不綁定廠商的逐字資料（偵測到的語言 + 每個字（或一小段話）的起訖時間、
含標點的文字、原始講者標籤）。之後的切片段、講者編號都只看這個格式（見 app/services/segmentation.py）。

跑在哪裡是設定（見 docs/adr/0003）：
- 本地（STT_BASE_URL）：自架的 vLLM 跑 Breeze-ASR-25，講者分離在這個服務裡用 CPU 跑，見 local_speech.py。有設定就用它。
- Deepgram Nova-3（DEEPGRAM_API_KEY）：一次呼叫同時完成轉錄和講者分離；為什麼不是 Groq Whisper 見
  docs/adr/0001-deepgram-replaces-groq-for-transcription-and-diarization.md。
兩個都沒設時 raise RecognitionNotConfigured（不重試，Job 失敗並說明）。設定是系統設定頁存的或環境變數（services/speech_settings）。
"""

import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx

from app.core import outbound
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


class RecognitionNotConfigured(Exception):
    """部署的人還沒設定語音辨識（本地伺服器或 Deepgram）。"""


_DEEPGRAM_URL = "https://api.deepgram.com/v1/listen"
DEEPGRAM = "deepgram"
# 上傳時選「自動偵測」（見 docs/adr/0002）：請 Deepgram 在這幾種語言之間判斷整個檔案是哪一種。Deepgram 的中文偵測只有 zh，
# 沒有 zh-TW。
AUTO = "auto"
_DETECTABLE_LANGUAGES = ("zh", "en")


def _is_local() -> bool:
    from app.services import speech_settings  # 設定頁存的優先（用到資料庫，用到才載入）

    return speech_settings.current().local


def provider() -> str:
    """目前用的語音辨識服務（記轉錄用量用）。"""
    from app.services import local_speech

    return local_speech.PROVIDER if _is_local() else DEEPGRAM


def model_name() -> str:
    """目前用的語音辨識模型（記轉錄用量用）。"""
    from app.services import speech_settings

    return speech_settings.current().stt_model if _is_local() else settings.deepgram_model

# 音檔直接以檔案內容上傳（不傳 URL：本機的 MinIO 從網際網路上連不到）。幾十分鐘的音檔上傳加處理要一點時間，
# 讀取逾時放寬；連不上則很快放棄，交給訊息層級重試。
_client = outbound.client(timeout=httpx.Timeout(600.0, connect=10.0))


def recognize(audio_path: Path, language: str | None = None) -> Recognition:
    """轉錄並做講者分離。language 是上傳時選的語言（zh-TW、en，或 AUTO 自動偵測）；沒有（升級前的舊訊息）就用設定的預設。
    HTTP 錯誤一律 raise（暫時性與否由 is_transient_recognition_error() 判斷）。"""
    chosen = language or settings.deepgram_language
    if _is_local():
        from app.services import local_speech  # local_speech 用到這裡的資料型別

        return local_speech.recognize(audio_path, chosen)
    from app.services import speech_settings

    deepgram_key = speech_settings.current().deepgram_api_key
    if not deepgram_key:
        raise RecognitionNotConfigured(
            "語音辨識尚未設定：請部署的人設定本地語音辨識（STT_BASE_URL、STT_MODEL）或 Deepgram（DEEPGRAM_API_KEY）")
    logger.info("calling Deepgram (%s, %s) for %s", settings.deepgram_model, chosen, audio_path)
    language_params = ([("detect_language", code) for code in _DETECTABLE_LANGUAGES] if chosen == AUTO
                       else [("language", chosen)])
    with audio_path.open("rb") as audio:
        response = _client.post(
            _DEEPGRAM_URL,
            params=[
                ("model", settings.deepgram_model),
                *language_params,
                ("diarize", "true"),
                ("smart_format", "true"),
                ("punctuate", "true"),
            ],
            headers={
                "Authorization": f"Token {deepgram_key}",
                # Deepgram 自己從內容判斷音訊格式，AUDIO 上傳的原始檔跟 VIDEO 抽出來的音軌格式不一定相同。
                "Content-Type": "application/octet-stream",
            },
            content=audio,
        )
    response.raise_for_status()
    return _parse(response.json(), chosen)


def _parse(body: dict[str, Any], chosen: str) -> Recognition:
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
    # 指定語言時 Deepgram 不回 detected_language，這時就是指定的語言；自動偵測卻沒回結果時是「無法判定」（und）。
    duration = body.get("metadata", {}).get("duration")
    return Recognition(
        language=channel.get("detected_language") or ("und" if chosen == AUTO else chosen),
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
