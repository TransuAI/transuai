package com.transuai.gateway.ratelimit;

import java.time.Duration;
import java.util.List;

import org.springframework.dao.DataAccessException;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.RedisScript;
import org.springframework.stereotype.Component;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

/**
 * 固定視窗的計數器，存在 Redis（gateway 有多個副本時共用）：每個鍵第一次計數時開始一個視窗，視窗結束就重算。
 * Redis 連不上時一律放行並記 log（fail-open）——Redis 故障不能把所有人擋在外面。
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class RateLimiter {

    /** 計一次；第一次時設定視窗。回傳 {計數, 視窗剩幾毫秒}。 */
    @SuppressWarnings("rawtypes")
    private static final RedisScript<List> HIT = RedisScript.of("""
            local count = redis.call('INCR', KEYS[1])
            if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
            return {count, redis.call('PTTL', KEYS[1])}
            """, List.class);

    private static final String PREFIX = "rate-limit:";

    private final StringRedisTemplate redis;

    public record Decision(boolean allowed, long retryAfterSeconds) {
        static final Decision ALLOWED = new Decision(true, 0);
    }

    /** 計一次，並回答這次算不算超過（第 limit + 1 次起超過）。 */
    public Decision hit(String key, RateLimitProperties.Rule rule) {
        try {
            List<?> result = redis.execute(HIT, List.of(PREFIX + key), String.valueOf(rule.window().toMillis()));
            long count = ((Number) result.get(0)).longValue();
            return count <= rule.limit() ? Decision.ALLOWED : blocked(((Number) result.get(1)).longValue());
        } catch (DataAccessException e) {
            log.warn("rate limit {} not checked, Redis unavailable: {}", key, e.getMessage());
            return Decision.ALLOWED;
        }
    }

    /** 不計數，只看是不是已經到了上限（例如「失敗幾次」：先看、失敗了才計）。 */
    public Decision peek(String key, RateLimitProperties.Rule rule) {
        try {
            String count = redis.opsForValue().get(PREFIX + key);
            if (count == null || Long.parseLong(count) < rule.limit()) {
                return Decision.ALLOWED;
            }
            Long ttl = redis.getExpire(PREFIX + key);
            return blocked(ttl == null ? rule.window().toMillis() : Duration.ofSeconds(ttl).toMillis());
        } catch (DataAccessException e) {
            log.warn("rate limit {} not checked, Redis unavailable: {}", key, e.getMessage());
            return Decision.ALLOWED;
        }
    }

    public void reset(String key) {
        try {
            redis.delete(PREFIX + key);
        } catch (DataAccessException e) {
            log.warn("rate limit {} not reset, Redis unavailable: {}", key, e.getMessage());
        }
    }

    private static Decision blocked(long remainingMillis) {
        return new Decision(false, Math.max(1, (remainingMillis + 999) / 1000));
    }
}
