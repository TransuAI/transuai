"""講者分離（本地語音辨識用，見 docs/adr/0003）：在這個服務裡用 CPU 跑 sherpa-onnx——pyannote segmentation-3.0（ONNX）切出有人說話的
片段、3D-Speaker 的 CAM++ 算每段的講者向量、再分群。模型在 DIARIZATION_MODELS_DIR（Dockerfile 打包進 image，不用連網）；沒有模型時
不分講者（每個片段都沒有講者）。

在另一個 process 裡跑：sherpa-onnx 處理時一直拿著 Python 的 GIL（一小時的錄音要好幾分鐘），在這個 process 裡跑的話 gRPC（看逐字稿）、
RabbitMQ 的其他連線全部停住。子 process 自己讀檔、解碼、分講者，只把結果（每段誰在說話）傳回來，做完就結束——解碼的音訊（一小時約 230MB）
與模型用的記憶體也跟著還回去，不跟後面的語音辨識同時佔著。"""

import logging
import multiprocessing
from concurrent.futures import ProcessPoolExecutor
from concurrent.futures.process import BrokenProcessPool
from dataclasses import dataclass
from pathlib import Path

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


def is_available() -> bool:
    models = Path(settings.diarization_models_dir)
    return (models / _SEGMENTATION).is_file() and (models / _EMBEDDING).is_file()


class DiarizationFailed(Exception):
    """講者分離沒做成：子 process 沒做完就結束了（通常是記憶體不夠被系統砍掉），或在裡面出錯。"""


def diarize(audio_path: Path) -> list[SpeakerTurn]:
    """誰在什麼時候說話，依開始時間排序；可能重疊（兩人同時說話）。在子 process 裡讀檔、解碼、分講者（見模組說明）。
    子 process 被砍掉（記憶體不夠）時 raise DiarizationFailed，不會卡住。"""
    threshold = _threshold()
    # spawn：子 process 從頭開始，不繼承這個 process 的 thread 與連線（fork 一個有很多 thread 的 process 不安全）。
    # 用 ProcessPoolExecutor 不用 multiprocessing.Pool：子 process 被砍掉時 Pool 會換一個新的、這個工作永遠等不到結果。
    with ProcessPoolExecutor(max_workers=1, mp_context=multiprocessing.get_context("spawn")) as pool:
        try:
            turns = pool.submit(_diarize_file, str(audio_path), threshold).result()
        except BrokenProcessPool as error:
            raise DiarizationFailed("講者分離的 process 沒做完就結束了（可能是記憶體不夠）") from error
        except Exception as error:  # 模型壞了、檔案讀不了……講者分離是附帶的，呼叫端照樣轉錄
            raise DiarizationFailed(f"講者分離失敗：{error!r}") from error
    return [SpeakerTurn(start, end, speaker) for start, end, speaker in turns]


def _threshold() -> float:
    from app.services import speech_settings  # 門檻是系統設定頁存的或環境變數（要讀資料庫，在這個 process 讀好再傳過去）

    return speech_settings.current().diarization_threshold


def _diarize_file(audio_path: str, threshold: float) -> list[tuple[float, float, str]]:
    """在子 process 裡跑：解碼、分講者，回傳 (start, end, speaker)。"""
    from app.services.local_speech import _decode  # 只在子 process 用到（避免 local_speech ↔ diarization 互相 import）

    samples = _decode(Path(audio_path))
    result = _diarizer(threshold).process(samples).sort_by_start_time()
    return [(float(r.start), float(r.end), str(r.speaker)) for r in result]


def _diarizer(threshold: float):
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
    logger.info("loaded the diarization models from %s (threshold %s)", models, threshold)
    return sherpa_onnx.OfflineSpeakerDiarization(config)
