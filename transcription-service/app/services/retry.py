"""語音辨識暫時性錯誤的訊息層級 retry：跟 `ai-service`（`app/services/retry.py`）同一套設計，只是
trim 到這個服務目前真的用得到的部分——這裡沒有 HF 呼叫，也還沒把 gRPC 呼叫（`job_status_client`）
納入這個機制（那屬於之後對齊 `ai-service-grpc-resilience` 的範圍，這次先不做）。哪些錯誤算暫時性由
語音辨識 adapter 自己判斷（`app/services/speech_recognition.py` 的 `is_transient_recognition_error()`）。

架構理由（訊息層級 requeue 而非 in-process 重試）見 ai-service/docs/adr/0001-message-level-retry-for-transient-external-failures.md——
這裡是同一個已經做過的決定，套用到 transcription-service 自己的語音辨識呼叫，不是一個新的取捨。

這個服務版本的取捨成本跟 ai-service 略有不同：重試會讓整個 pipeline 從頭重跑，包含
`download_object()`（重新從物件儲存下載檔案）跟 VIDEO 檔案的 `extract_audio_track()`（重新跑一次
ffmpeg），不只是重打語音辨識 API。跟 ai-service 的 ADR 0001 一樣，這是刻意接受的成本換取機制簡單——
沒有任何中間結果會被存進資料庫，沒有部分進度可以保留。
"""

from app.core.config import settings

RETRY_COUNT_HEADER = "x-retry-count"
MAX_RETRIES = 2  # 最多重試 2 次（1 次原始送達 + 2 次重試 = 3 次總嘗試）


class RetryableMessageError(Exception):
    """process_message() 遇到暫時性失敗、且訊息還有重試預算時 raise 這個例外。

    不會被 process_message() 自己吞掉，一路往外傳給 consumer.py 的 on_message callback，
    由它決定把訊息送進哪一條 retry queue（見 retry_queue_for()），而不是走現有的 Job FAILED 路徑。
    """


def retry_queue_for(retry_count: int) -> str | None:
    """給定一則訊息目前已經重試過的次數，回傳下一次重試該送去哪條 queue；
    重試預算（MAX_RETRIES 次）用盡則回傳 None。

    retry_count 0 -> 第一次重試（2 秒 TTL queue）
    retry_count 1 -> 第二次重試（4 秒 TTL queue）
    retry_count >= MAX_RETRIES -> None（預算用盡，維持現狀走 FAILED 路徑）
    """
    if retry_count == 0:
        return settings.retry_queue_2s
    if retry_count == 1:
        return settings.retry_queue_4s
    return None
