package com.transuai.gateway.cache;

import java.time.Duration;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.RedisScript;
import org.springframework.stereotype.Component;

import com.transuai.gateway.redis.RedisFallback;

/**
 * cache-aside：Job 的擁有者（Job → 使用者），存在 Redis。擁有者不會變；刪除 Job 時不是刪掉鍵，而是寫一個「已刪除」的標記
 * （{@link #forget}）：刪除之前就在路上的請求晚一步寫回擁有者時（{@link #remember}），標記在就不寫，被刪掉的 Job 不會又被當成還在
 * （Job id 是 UUID、不會重用）。有效時間（{@code app.cache.job-owner-ttl}）只是保險，也限制了「刪除時 Redis 剛好連不上、標記沒寫
 * 成」最多多久。鍵用正規化的 UUID，同一個 Job 不同寫法（大小寫）是同一個鍵；不是 UUID 的不記。Redis 連不上、或存的值看不懂時當作
 * 沒記住，照樣去問 upload-service。
 */
@Component
public class JobOwnerCache {

    private static final String PREFIX = "job-owner:";
    private static final String DELETED = "deleted";

    /** 寫回擁有者，除非這個 Job 已經標記刪除。ARGV：擁有者、有效毫秒、刪除標記。 */
    private static final RedisScript<Long> REMEMBER = RedisScript.of("""
            if redis.call('GET', KEYS[1]) == ARGV[3] then return 0 end
            redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2])
            return 1
            """, Long.class);

    private final StringRedisTemplate redis;
    private final Duration ttl;

    /** 記住的內容：擁有者，或這個 Job 已經刪掉了。 */
    public sealed interface Entry {
    }

    public record Owner(UUID id) implements Entry {
    }

    public record Deleted() implements Entry {
    }

    public JobOwnerCache(StringRedisTemplate redis, @Value("${app.cache.job-owner-ttl}") Duration ttl) {
        this.redis = redis;
        this.ttl = ttl;
    }

    /** 記住的內容；沒記過、Redis 連不上、或存的值看不懂時是 empty。 */
    public Optional<Entry> lookup(String jobId) {
        return key(jobId).flatMap(key -> RedisFallback.orElse(what(key), Optional.<Entry>empty(),
                () -> Optional.ofNullable(redis.opsForValue().get(key)).flatMap(JobOwnerCache::entry)));
    }

    public void remember(String jobId, UUID owner) {
        key(jobId).ifPresent(key -> RedisFallback.run(what(key), () -> redis.execute(REMEMBER, List.of(key),
                owner.toString(), String.valueOf(ttl.toMillis()), DELETED)));
    }

    /** Job 刪掉了：標記起來，之後的請求直接 404，晚到的寫回也寫不進來。 */
    public void forget(String jobId) {
        key(jobId).ifPresent(key -> RedisFallback.run(what(key), () -> redis.opsForValue().set(key, DELETED, ttl)));
    }

    private static Optional<Entry> entry(String value) {
        if (DELETED.equals(value)) {
            return Optional.of(new Deleted());
        }
        try {
            return Optional.of(new Owner(UUID.fromString(value)));
        } catch (IllegalArgumentException e) {
            return Optional.empty();
        }
    }

    private static String what(String key) {
        return "job owner cache " + key;
    }

    private static Optional<String> key(String jobId) {
        try {
            return Optional.of(PREFIX + UUID.fromString(jobId));
        } catch (IllegalArgumentException e) {
            return Optional.empty();
        }
    }
}
