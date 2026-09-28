"""cache-aside：逐字稿（GetTranscript 的回應），存在 Redis。讀很多——問答的每一題、出題、會後處理、重新產生摘要、前端——而且只在
編輯時才變。

每份快取帶著逐字稿的 revision（每次編輯 +1）。讀的時候沒有就讀資料庫、寫回（`remember`）；編輯成功之後把「最新的 revision」記下並
丟掉內容（`record_edit`）。寫回只在自己讀到的 revision 不比記下的舊時才寫：編輯之前就開始、晚一步寫回的讀取，帶不回舊版。比較與寫入在
同一個 Lua script 裡。有效時間是保險。

會寫逐字稿的地方都要呼叫 `record_edit`：三種編輯，與 pipeline 存檔（訊息重送時會再存一次）。之後要刪除逐字稿的（例如刪除帳號）也要。
鍵帶著格式的版本（`v1`）：`Transcript` 的欄位變了就換版本，舊格式的快取不會被讀到。Redis 連不上時照樣讀資料庫，只記 log；不重試
（redis-py 預設會重試 10 次，連不上時一次要好幾秒）。"""

import logging
import uuid

import redis
from redis.backoff import NoBackoff
from redis.retry import Retry

from app.core.config import settings
from app.proto_gen import transcription_pb2

logger = logging.getLogger(__name__)



def _new_client(host: str, port: int) -> redis.Redis:
    return redis.Redis(
        host=host, port=port, password=settings.redis_password or None,
        socket_timeout=settings.redis_timeout_seconds, socket_connect_timeout=settings.redis_timeout_seconds,
        retry=Retry(NoBackoff(), 0))


_client = _new_client(settings.redis_host, settings.redis_port)

# 寫回：記下的 revision 比這份新就不寫。KEYS[1]；ARGV：revision、內容、有效毫秒。
_REMEMBER = """
local current = redis.call('HGET', KEYS[1], 'revision')
if current and tonumber(current) > tonumber(ARGV[1]) then return 0 end
redis.call('HSET', KEYS[1], 'revision', ARGV[1], 'data', ARGV[2])
redis.call('PEXPIRE', KEYS[1], ARGV[3])
return 1
"""

# 編輯之後：記下最新的 revision（取大的，同時的編輯不會倒退），丟掉內容。ARGV：revision、有效毫秒。
_EDITED = """
local current = redis.call('HGET', KEYS[1], 'revision')
if not current or tonumber(current) < tonumber(ARGV[1]) then redis.call('HSET', KEYS[1], 'revision', ARGV[1]) end
redis.call('HDEL', KEYS[1], 'data')
redis.call('PEXPIRE', KEYS[1], ARGV[2])
return 1
"""


def _key(job_id: uuid.UUID) -> str:
    return f"transcript:v1:{job_id}"


def _ttl_millis() -> int:
    return settings.transcript_cache_ttl_seconds * 1000


def cached(job_id: uuid.UUID) -> transcription_pb2.Transcript | None:
    """快取的逐字稿；沒有、剛編輯過、或 Redis 連不上時是 None。"""
    try:
        data = _client.hget(_key(job_id), "data")
    except redis.RedisError as exc:
        logger.warning("transcript cache for job %s skipped, Redis unavailable: %s", job_id, exc)
        return None
    return transcription_pb2.Transcript.FromString(data) if isinstance(data, bytes) else None


def remember(job_id: uuid.UUID, transcript: transcription_pb2.Transcript) -> None:
    """讀資料庫之後寫回（帶著它的 revision）。"""
    try:
        _client.eval(_REMEMBER, 1, _key(job_id), transcript.revision, transcript.SerializeToString(), _ttl_millis())
    except redis.RedisError as exc:
        logger.warning("transcript cache for job %s not written, Redis unavailable: %s", job_id, exc)


def record_edit(job_id: uuid.UUID, revision: int) -> None:
    """編輯成功（已經寫進資料庫）之後呼叫。Redis 連不上時舊內容最多留到有效時間結束。"""
    try:
        _client.eval(_EDITED, 1, _key(job_id), revision, _ttl_millis())
    except redis.RedisError as exc:
        logger.warning("transcript cache for job %s not invalidated, Redis unavailable: %s", job_id, exc)
