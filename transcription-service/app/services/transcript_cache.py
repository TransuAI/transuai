"""cache-aside：逐字稿（GetTranscript 的回應），存在 Redis。讀很多——問答的每一題、出題、會後處理、重新產生摘要、前端——而且只在
編輯時才變。

每份快取帶著逐字稿的 revision（每次編輯 +1）。讀的時候沒有就讀資料庫、寫回（`remember`）；編輯成功之後把「最新的 revision」記下並
丟掉內容（`edited`）。寫回只在自己讀到的 revision 不比記下的舊時才寫：編輯之前就開始、晚一步寫回的讀取，帶不回舊版。比較與寫入在
同一個 Lua script 裡。有效時間是保險。Redis 連不上時照樣讀資料庫，只記 log。"""

import logging
import uuid

import redis

from app.core.config import settings

logger = logging.getLogger(__name__)

_client = redis.Redis(
    host=settings.redis_host, port=settings.redis_port, password=settings.redis_password or None,
    socket_timeout=settings.redis_timeout_seconds, socket_connect_timeout=settings.redis_timeout_seconds)

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
    return f"transcript:{job_id}"


def _ttl_millis() -> int:
    return settings.transcript_cache_ttl_seconds * 1000


def cached(job_id: uuid.UUID) -> bytes | None:
    """快取的逐字稿（序列化的 Transcript）；沒有、剛編輯過、或 Redis 連不上時是 None。"""
    try:
        return _client.hget(_key(job_id), "data")  # type: ignore[return-value]
    except redis.RedisError as exc:
        logger.warning("transcript cache for job %s skipped, Redis unavailable: %s", job_id, exc)
        return None


def remember(job_id: uuid.UUID, revision: int, data: bytes) -> None:
    try:
        _client.eval(_REMEMBER, 1, _key(job_id), revision, data, _ttl_millis())
    except redis.RedisError as exc:
        logger.warning("transcript cache for job %s not written, Redis unavailable: %s", job_id, exc)


def edited(job_id: uuid.UUID, revision: int) -> None:
    """編輯成功（已經寫進資料庫）之後呼叫。Redis 連不上時舊內容最多留到有效時間結束。"""
    try:
        _client.eval(_EDITED, 1, _key(job_id), revision, _ttl_millis())
    except redis.RedisError as exc:
        logger.warning("transcript cache for job %s not invalidated, Redis unavailable: %s", job_id, exc)
