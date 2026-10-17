"""講者分離（本地語音辨識用，見 docs/adr/0003）：在這個服務裡用 CPU 跑 sherpa-onnx——pyannote segmentation-3.0（ONNX）切出有人說話的
片段、3D-Speaker 的 CAM++ 算每段的講者向量、再分群。模型在 DIARIZATION_MODELS_DIR（Dockerfile 打包進 image，不用連網）；沒有模型時
不分講者（每個片段都沒有講者）。輸入是 16kHz 單聲道的 PCM。"""

import logging
import threading
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from app.core.config import settings

logger = logging.getLogger(__name__)

SAMPLE_RATE = 16000
_SEGMENTATION = "sherpa-onnx-pyannote-segmentation-3-0/model.onnx"
_EMBEDDING = "3dspeaker_speech_campplus_sv_zh-cn_16k-common.onnx"
# 這麼短的說話、這麼短的停頓不算（跟 sherpa-onnx 的範例一樣）。
_MIN_SPEECH_SECONDS = 0.3
_MIN_SILENCE_SECONDS = 0.5


@dataclass(frozen=True)
class SpeakerTurn:
    start: float
    end: float
    speaker: str  # 這次分離自己的編號（"0"、"1"…），之後由 segmentation 換成 Job 的 S1、S2…


_lock = threading.Lock()
_diarizer = None


def is_available() -> bool:
    models = Path(settings.diarization_models_dir)
    return (models / _SEGMENTATION).is_file() and (models / _EMBEDDING).is_file()


def diarize(samples: np.ndarray) -> list[SpeakerTurn]:
    """誰在什麼時候說話，依開始時間排序；可能重疊（兩人同時說話）。samples 是 16kHz 單聲道、-1～1 的 float32。"""
    from app.services import speech_settings  # 門檻是系統設定頁存的或環境變數

    result = _get_diarizer(speech_settings.current().diarization_threshold).process(samples).sort_by_start_time()
    return [SpeakerTurn(start=float(r.start), end=float(r.end), speaker=str(r.speaker)) for r in result]


def _get_diarizer(threshold: float):
    # 載入模型要一兩秒，第一次用到（或門檻換了）才載入；同時只處理一則訊息，但 gRPC 與 consumer 在不同 thread，載入時上鎖。
    global _diarizer
    with _lock:
        if _diarizer is None or _diarizer[0] != threshold:
            import sherpa_onnx  # 原生函式庫較大，用到才載入（測試與 Deepgram 路徑不需要）

            models = Path(settings.diarization_models_dir)
            config = sherpa_onnx.OfflineSpeakerDiarizationConfig(
                segmentation=sherpa_onnx.OfflineSpeakerSegmentationModelConfig(
                    pyannote=sherpa_onnx.OfflineSpeakerSegmentationPyannoteModelConfig(model=str(models / _SEGMENTATION)),
                    num_threads=settings.diarization_threads,
                ),
                embedding=sherpa_onnx.SpeakerEmbeddingExtractorConfig(
                    model=str(models / _EMBEDDING), num_threads=settings.diarization_threads),
                clustering=sherpa_onnx.FastClusteringConfig(num_clusters=-1, threshold=threshold),
                min_duration_on=_MIN_SPEECH_SECONDS,
                min_duration_off=_MIN_SILENCE_SECONDS,
            )
            if not config.validate():
                raise RuntimeError(f"講者分離的模型設定不正確（{models}）")
            _diarizer = (threshold, sherpa_onnx.OfflineSpeakerDiarization(config))
            logger.info("loaded the diarization models from %s (threshold %s)", models, threshold)
        return _diarizer[1]
