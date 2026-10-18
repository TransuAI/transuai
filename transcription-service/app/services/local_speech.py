"""本地語音辨識（見 docs/adr/0003）：先在這裡分出誰在什麼時候說話（diarization.py，CPU），再把每段講者的話送到自架的 vLLM 的
OpenAI 相容 /v1/audio/transcriptions（Breeze-ASR-25）。先分講者再轉錄：Whisper 系的模型只給片段（不是每個字）的時間，一個片段
常常跨好幾個人；一段只送一個人的話，文字就不會掛錯人。

每段送出的音訊最長 30 秒（Whisper 一次看的長度）；同一個人隔不到 1 秒的話併成一段，兩人同時說話的部分只轉錄一次。沒有講者分離的
模型時，整段錄音每 30 秒切一段，不分講者。回傳的片段時間加回這段在整段錄音裡的位置，當成 Recognition 的「字」交給 segmentation。
"""

import io
import logging
import subprocess
import time
import wave
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path

import httpx
import imageio_ffmpeg
import numpy as np

from app.core import outbound
from app.core.config import settings
from app.services import diarization, speech_settings
from app.services.diarization import SAMPLE_RATE, SpeakerTurn
from app.services.speech_recognition import AUTO, Recognition, RecognizedWord

logger = logging.getLogger(__name__)

PROVIDER = "local"
MAX_CHUNK_SECONDS = 30.0
_MERGE_GAP_SECONDS = 1.0
# 比這短的聲音不送（Whisper 對太短的片段容易憑空生出字）。
_MIN_CHUNK_SECONDS = 0.5
# 同時送幾段：伺服器自己排隊，這裡只是讓它一直有下一段可做。
_CONCURRENT_REQUESTS = 4
# 上傳時選的語言 → Whisper 的語言代碼；自動偵測就不指定。
_WHISPER_LANGUAGE = {"zh-TW": "zh", "en": "en"}

# 一段暫時失敗時，等這麼久再試（共 3 次）。
_CHUNK_RETRY_DELAYS_SECONDS = (2, 5)
# 一段最長 30 秒，辨識很快；連不上則很快放棄，交給訊息層級重試。
_client = outbound.client(timeout=httpx.Timeout(300.0, connect=10.0))


@dataclass(frozen=True)
class _Chunk:
    start: float
    end: float
    speaker: str | None


def recognize(audio_path: Path, chosen: str) -> Recognition:
    # 先分講者（子 process，自己解碼；做完記憶體就還回去），再解碼一次給語音辨識切段。分講者失敗（記憶體不夠）時照樣轉錄、只是不分講者
    #（使用者還是拿得到逐字稿，可以自己標講者），不讓整個檔案失敗。
    turns = None
    if diarization.is_available():
        try:
            turns = diarization.diarize(audio_path)
        except diarization.DiarizationFailed:
            logger.exception("diarization failed for %s; transcribing without speakers", audio_path)
    samples = _decode(audio_path)
    duration = len(samples) / SAMPLE_RATE
    if turns is None:
        logger.warning("no diarization models in %s: transcribing without speakers", settings.diarization_models_dir)
    chunks = _chunks(turns, duration)
    config = speech_settings.current()
    logger.info("transcribing %s (%.0fs) in %d chunks with %s at %s", audio_path, duration, len(chunks),
                config.stt_model, config.stt_base_url)

    whisper_language = _WHISPER_LANGUAGE.get(chosen)
    with ThreadPoolExecutor(max_workers=_CONCURRENT_REQUESTS) as pool:
        answers = list(pool.map(lambda chunk: _transcribe(samples, chunk, whisper_language, config), chunks))

    words: list[RecognizedWord] = []
    detected: Counter[str] = Counter()
    for chunk, (language, segments) in zip(chunks, answers):
        if language:
            detected[language] += 1
        for start, end, text in segments:
            words.append(RecognizedWord(start=round(chunk.start + start, 3), end=round(min(chunk.start + end, chunk.end), 3),
                                        text=text, speaker=chunk.speaker))
    if chosen == AUTO:
        language = detected.most_common(1)[0][0] if detected else "und"
    else:
        language = chosen
    return Recognition(language=language, words=words, audio_seconds=duration)


def _chunks(turns: list[SpeakerTurn] | None, duration: float) -> list[_Chunk]:
    """要送去轉錄的段落，依時間排序、互不重疊、每段最長 MAX_CHUNK_SECONDS。"""
    if turns is None:
        merged = [_Chunk(0.0, duration, None)]
    else:
        merged = []
        for turn in sorted(turns, key=lambda t: t.start):
            start = max(turn.start, merged[-1].end) if merged else turn.start  # 兩人同時說話的部分只轉錄一次
            if turn.end - start < _MIN_CHUNK_SECONDS:
                continue
            last = merged[-1] if merged else None
            if last and last.speaker == turn.speaker and start - last.end < _MERGE_GAP_SECONDS:
                merged[-1] = _Chunk(last.start, max(last.end, turn.end), last.speaker)
            else:
                merged.append(_Chunk(start, turn.end, turn.speaker))
    # 太長的切成幾段（最後一段太短就併進前一段）。
    chunks = []
    for chunk in merged:
        start = chunk.start
        while chunk.end - start > MAX_CHUNK_SECONDS + _MIN_CHUNK_SECONDS:
            chunks.append(_Chunk(start, start + MAX_CHUNK_SECONDS, chunk.speaker))
            start += MAX_CHUNK_SECONDS
        if chunk.end - start >= _MIN_CHUNK_SECONDS:
            chunks.append(_Chunk(start, chunk.end, chunk.speaker))
    return chunks


def _transcribe(samples: np.ndarray, chunk: _Chunk, language: str | None,
                config: "speech_settings.SpeechConfig") -> tuple[str | None, list[tuple[float, float, str]]]:
    """一段音訊送去轉錄，回傳偵測到的語言與片段（相對這段開頭的起訖時間、文字）。HTTP 錯誤一律 raise（暫時性與否由
    speech_recognition.is_transient_recognition_error 判斷）。"""
    piece = _wav(samples[int(chunk.start * SAMPLE_RATE):int(chunk.end * SAMPLE_RATE)])
    try:
        body = _post(piece, config, language, timed=True)
    except httpx.HTTPStatusError as error:
        if error.response.status_code != 500:
            raise
        # vLLM 算片段時間時，辨識結果幾乎是空的那段（例如只有雜音）會出錯回 500（v0.31 的 _get_verbose_segments）。這段改成只要
        # 文字，整段當一個片段；再不行才算失敗（一段失敗整個檔案都要重來）。
        logger.warning("the speech server failed on %.1f–%.1fs with timed segments; asking for the text only",
                       chunk.start, chunk.end)
        try:
            body = _post(piece, config, language, timed=False)
        except httpx.HTTPError:
            raise error from None
    segments = [(float(s["start"]), float(s["end"]), s["text"].strip()) for s in body.get("segments") or []]
    if not segments and (body.get("text") or "").strip():
        segments = [(0.0, chunk.end - chunk.start, body["text"].strip())]
    return body.get("language"), [segment for segment in segments if segment[2]]


def _post(wav: bytes, config: "speech_settings.SpeechConfig", language: str | None, *, timed: bool) -> dict:
    """送一段。暫時性的錯誤（連不上、逾時、429、500 以外的 5xx）在這一段重試幾次——一小時的錄音有好幾百段，一段失敗就整個檔案（含幾分鐘的
    講者分離）從頭再來太浪費；還是不行才往外丟，交給訊息層級的重試。500 不在這裡重試（見 _transcribe）。"""
    for attempt, delay in enumerate(_CHUNK_RETRY_DELAYS_SECONDS + (None,)):
        try:
            return _post_once(wav, config, language, timed=timed)
        except (httpx.TransportError, httpx.HTTPStatusError) as error:
            status = error.response.status_code if isinstance(error, httpx.HTTPStatusError) else None
            if delay is None or not (status is None or status == 429 or status > 500):
                raise
            logger.warning("the speech server failed (%r); trying this chunk again in %ss", error, delay)
            time.sleep(delay)
    raise AssertionError("unreachable")


def _post_once(wav: bytes, config: "speech_settings.SpeechConfig", language: str | None, *, timed: bool) -> dict:
    data = {"model": config.stt_model, "temperature": "0",
            **({"response_format": "verbose_json", "timestamp_granularities[]": "segment"} if timed
               else {"response_format": "json"})}
    if language:
        data["language"] = language
    headers = {"Authorization": f"Bearer {config.stt_api_key}"} if config.stt_api_key else {}
    response = _client.post(f"{config.stt_base_url.rstrip('/')}/audio/transcriptions", data=data, headers=headers,
                            files={"file": ("chunk.wav", wav, "audio/wav")})
    response.raise_for_status()
    return response.json()


def _decode(audio_path: Path) -> np.ndarray:
    """任何 ffmpeg 讀得懂的音檔 → 16kHz 單聲道、-1～1 的 float32（唯讀）。ffmpeg 直接輸出 float32，陣列就用它的輸出、不再複製——一小時的
    錄音約 230MB，記憶體小的伺服器（8GB）上多一份複製就是多幾百 MB。"""
    completed = subprocess.run(
        [imageio_ffmpeg.get_ffmpeg_exe(), "-nostdin", "-loglevel", "error", "-i", str(audio_path),
         "-ac", "1", "-ar", str(SAMPLE_RATE), "-f", "f32le", "-"],
        capture_output=True, check=True)
    return np.frombuffer(completed.stdout, dtype=np.float32)


def _wav(samples: np.ndarray) -> bytes:
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as out:
        out.setnchannels(1)
        out.setsampwidth(2)
        out.setframerate(SAMPLE_RATE)
        out.writeframes((np.clip(samples, -1.0, 1.0) * 32767).astype(np.int16).tobytes())
    return buffer.getvalue()
