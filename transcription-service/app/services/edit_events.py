import logging
import time

from pika import BlockingConnection

from app.services.event_publisher import connection_params, publish_transcript_edited as publish_on_channel

logger = logging.getLogger(__name__)

_ATTEMPTS = 3
_INITIAL_DELAY_SECONDS = 0.2
_MAX_DELAY_SECONDS = 0.8

TRANSCRIPT_EDITED_EVENT_LOST_MARKER = "TRANSCRIPTION_SERVICE_TRANSCRIPT_EDITED_EVENT_LOST"


def _publish_once(job_id: str) -> None:
    # The gRPC handler threads can't share the consumer thread's pika connection (pika isn't
    # thread-safe), and edits are rare, so each event gets its own short-lived connection. It runs
    # inside the user's save request, so it must never hang: short socket / blocked-connection
    # timeouts (a broker under a memory alarm blocks publishers) and a single connection attempt.
    connection = BlockingConnection(connection_params(
        socket_timeout=2, blocked_connection_timeout=2, connection_attempts=1))
    try:
        channel = connection.channel()
        # Publisher confirms: basic_publish only returns once the broker has taken the message.
        channel.confirm_delivery()
        publish_on_channel(channel, job_id)
    finally:
        connection.close()


def publish_transcript_edited(job_id: str) -> bool:
    """發送 transcript.edited { jobId }（見根目錄 docs/adr/0003）。失敗時做小型的 in-process 重試（3 次、
    200ms 起跳倍增、封頂 800ms）；仍然失敗就記一則帶固定 marker 的高嚴重度 log 並回傳 False——使用者
    的編輯已經存好了，不能因為事件發不出去就讓存檔失敗（代價是 ai-service 那邊的問答檢索資料要等
    下一次編輯才會更新）。

    跟 ai-service 的 retry_terminal_report 不同，這裡任何例外都重試：會失敗的只有連線 / 發佈本身，
    沒有「永久性、重試也沒用」的業務錯誤要先分出來。
    """
    delay = _INITIAL_DELAY_SECONDS
    for attempt in range(1, _ATTEMPTS + 1):
        try:
            _publish_once(job_id)
            logger.info("published transcript.edited for job %s", job_id)
            return True
        except Exception:
            if attempt == _ATTEMPTS:
                logger.exception("%s: job %s edited but transcript.edited could not be published",
                                 TRANSCRIPT_EDITED_EVENT_LOST_MARKER, job_id)
                return False
            logger.warning("publishing transcript.edited for job %s failed (attempt %d), retrying", job_id, attempt)
            time.sleep(delay)
            delay = min(delay * 2, _MAX_DELAY_SECONDS)
    return False
