import logging
import time
from typing import Callable

import grpc

from app.services.embedder import EmbeddingError
from app.services.llm_client import LlmError

logger = logging.getLogger(__name__)

RETRY_COUNT_HEADER = "x-retry-count"
# 每一次重試的延遲（TTL），依序對應第 1、2 次重試；見 ADR 0001。
_RETRY_DELAYS_MS = (2000, 4000)
MAX_RETRIES = len(_RETRY_DELAYS_MS)  # 最多重試 2 次（1 次原始送達 + 2 次重試 = 3 次總嘗試）

_RETRYABLE_GRPC_STATUS_CODES = {
    grpc.StatusCode.UNAVAILABLE,
    grpc.StatusCode.DEADLINE_EXCEEDED,
    grpc.StatusCode.RESOURCE_EXHAUSTED,
}

_TERMINAL_RETRY_ATTEMPTS = 3
_TERMINAL_RETRY_INITIAL_DELAY_SECONDS = 0.2
_TERMINAL_RETRY_MAX_DELAY_SECONDS = 0.8

TERMINAL_FAILURE_LOST_MARKER = "AI_SERVICE_TERMINAL_FAILURE_REPORT_LOST"


class RetryableMessageError(Exception):
    """process_message() 遇到暫時性失敗、且訊息還有重試預算時 raise 這個例外。

    不會被 process_message() 自己吞掉，一路往外傳給 consumer.py 的 on_message callback，
    由它決定把訊息送進哪一條 retry queue（見 retry_queue_for()），而不是走現有的 Job FAILED 路徑。
    見 ADR 0001（docs/adr/0001-message-level-retry-for-transient-external-failures.md）。
    """


def _retry_queue_name(source_queue: str, delay_ms: int) -> str:
    return f"{source_queue}.retry.{delay_ms // 1000}s"


def has_retry_budget(retry_count: int) -> bool:
    """這則訊息（已經重試過 retry_count 次）還能不能再重試一次。"""
    return retry_count < MAX_RETRIES


def retry_queue_for(source_queue: str, retry_count: int) -> str | None:
    """給定訊息原本被消費的 queue 跟它已經重試過的次數，回傳下一次重試該送去哪條 retry queue；
    重試預算用盡則回傳 None。

    retry_count 0 -> 第一次重試（<source>.retry.2s）
    retry_count 1 -> 第二次重試（<source>.retry.4s）
    retry_count >= MAX_RETRIES -> None（預算用盡，由呼叫端走各自的失敗路徑）
    """
    if not has_retry_budget(retry_count):
        return None
    return _retry_queue_name(source_queue, _RETRY_DELAYS_MS[retry_count])


def retry_queue_declarations(source_queue: str) -> list[tuple[str, dict[str, object]]]:
    """某個被消費的 queue 需要宣告的 retry queue：(名稱, queue arguments)。訊息 TTL 到期後透過
    default exchange（routing key 就是 queue 名稱）自動被 dead-letter 回 source_queue 本身，
    不需要另外宣告 exchange（見 ADR 0001）。每個被消費的 queue 各有自己的一組，重試才會回到
    對的處理函式。"""
    return [
        (_retry_queue_name(source_queue, delay_ms), {
            "x-message-ttl": delay_ms,
            "x-dead-letter-exchange": "",
            "x-dead-letter-routing-key": source_queue,
        })
        for delay_ms in _RETRY_DELAYS_MS
    ]


def is_retryable_embedding_error(exc: BaseException) -> bool:
    """embedding 呼叫的例外，由 embedder 分類好：429、5xx、逾時、連不上是暫時性。"""
    return isinstance(exc, EmbeddingError) and exc.transient


def is_retryable_grpc_error(exc: BaseException) -> bool:
    """內部 gRPC 呼叫（transcript-service / upload-service）例外分類，依 gRPC status code 判斷——
    UNAVAILABLE/DEADLINE_EXCEEDED/RESOURCE_EXHAUSTED 是暫時性的；NOT_FOUND、INVALID_ARGUMENT
    （job 真的不存在、ID 格式錯誤）等其他任何 code 都不重試。
    """
    if not isinstance(exc, grpc.RpcError):
        return False
    return exc.code() in _RETRYABLE_GRPC_STATUS_CODES


def is_retryable_llm_error(exc: BaseException) -> bool:
    """生成類呼叫（摘要、章節、問答）的例外，由 llm_client 分類好：429、5xx、逾時、連不上是暫時性。"""
    return isinstance(exc, LlmError) and exc.transient


def is_retryable_error(exc: BaseException) -> bool:
    """process_message() 的統一分類入口。生成類呼叫（llm_client）、embedding（embedder）、內部 gRPC 三種例外來源
    的型別互不重疊，依序檢查即可。"""
    return is_retryable_llm_error(exc) or is_retryable_embedding_error(exc) or is_retryable_grpc_error(exc)


def retry_terminal_report(report: Callable[[], None]) -> bool:
    """Job 已經確定失敗、回報 FAILED 狀態＋發送 job.failed 事件這個步驟專用的獨立重試。

    刻意跟訊息層級的 requeue 機制（RetryableMessageError）分開：這個回報動作要嘛徹底成功、
    要嘛徹底放棄，重跑整個 pipeline 對已經確定的失敗結果沒有任何幫助，只會浪費已經花掉的
    模型呼叫。只在失敗被分類為暫時性 gRPC 錯誤時才重試（3 次總嘗試，200ms 起跳、
    每次 x2、封頂 800ms）；分類為永久性失敗（例如 job 在 upload-service 那邊已經不存在）
    時立即放棄，不浪費重試次數。

    回傳 True 表示 report() 成功（可能重試過），False 表示重試預算用盡或遇到永久性失敗——
    呼叫端應該用清楚、好搜尋的方式記錄下來（見 TERMINAL_FAILURE_LOST_MARKER）。
    """
    delay = _TERMINAL_RETRY_INITIAL_DELAY_SECONDS
    for attempt in range(1, _TERMINAL_RETRY_ATTEMPTS + 1):
        try:
            report()
            return True
        except Exception as exc:
            is_last_attempt = attempt == _TERMINAL_RETRY_ATTEMPTS
            if is_last_attempt or not is_retryable_grpc_error(exc):
                return False
            time.sleep(delay)
            delay = min(delay * 2, _TERMINAL_RETRY_MAX_DELAY_SECONDS)
    return False
