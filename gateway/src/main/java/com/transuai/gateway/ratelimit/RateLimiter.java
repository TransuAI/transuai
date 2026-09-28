package com.transuai.gateway.ratelimit;

import java.util.List;
import java.util.function.Supplier;

import org.springframework.dao.DataAccessException;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.RedisScript;
import org.springframework.stereotype.Component;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

/**
 * 固定視窗的計數器，存在 Redis（gateway 有多個副本時共用）：每個鍵第一次計數時開始一個視窗，視窗結束就重算。
 * 計數與判斷在同一個 Lua script 裡完成，同時送出的請求也不會多算少算。Redis 連不上時一律放行並記 log
 * （fail-open）——Redis 故障不能把所有人擋在外面。
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class RateLimiter {

    /** 計一次；鍵沒有過期時間（第一次，或不知為何遺失了）就設定視窗。回傳 {計數, 視窗剩幾毫秒}。 */
    @SuppressWarnings("rawtypes")
    private static final RedisScript<List> HIT = RedisScript.of("""
            local count = redis.call('INCR', KEYS[1])
            if redis.call('PTTL', KEYS[1]) < 0 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
            return {count, redis.call('PTTL', KEYS[1])}
            """, List.class);

    /** 退回一次（還有計數時才減）。 */
    private static final RedisScript<Long> RELEASE = RedisScript.of("""
            if tonumber(redis.call('GET', KEYS[1]) or '0') > 0 then return redis.call('DECR', KEYS[1]) end
            return 0
            """, Long.class);

    private final StringRedisTemplate redis;

    public record Decision(boolean allowed, long retryAfterSeconds) {
        static final Decision ALLOWED = new Decision(true, 0);
    }

    /** 計一次，並回答這次算不算超過（第 limit + 1 次起超過）。 */
    public Decision hit(String key, RateLimitProperties.Rule rule) {
        return failOpen(key, Decision.ALLOWED, () -> {
            List<?> result = redis.execute(HIT, List.of(redisKey(key)), String.valueOf(rule.window().toMillis()));
            long count = ((Number) result.get(0)).longValue();
            long remainingMillis = ((Number) result.get(1)).longValue();
            return count <= rule.limit() ? Decision.ALLOWED
                    : new Decision(false, Math.max(1, (remainingMillis + 999) / 1000));
        });
    }

    /** 退回先前計的一次（例如那次嘗試其實沒有發生）。 */
    public void release(String key) {
        failOpen(key, null, () -> redis.execute(RELEASE, List.of(redisKey(key))));
    }

    public void reset(String key) {
        failOpen(key, null, () -> redis.delete(redisKey(key)));
    }

    private static String redisKey(String key) {
        return "rate-limit:" + key;
    }

    private static <T> T failOpen(String key, T whenUnavailable, Supplier<T> work) {
        try {
            return work.get();
        } catch (DataAccessException e) {
            log.warn("rate limit {} skipped, Redis unavailable: {}", key, e.getMessage());
            return whenUnavailable;
        }
    }
}
