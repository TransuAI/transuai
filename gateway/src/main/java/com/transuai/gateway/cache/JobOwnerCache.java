package com.transuai.gateway.cache;

import java.time.Duration;
import java.util.Optional;
import java.util.UUID;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

import com.transuai.gateway.redis.RedisFallback;

/**
 * cache-aside：Job 的擁有者（Job → 使用者），存在 Redis。擁有者不會變，只有刪除 Job 時要忘掉（{@link #forget}）；有效時間
 * （{@code app.cache.job-owner-ttl}）只是保險。鍵用正規化的 UUID，同一個 Job 不同寫法（大小寫）是同一個鍵；不是 UUID 的不記。
 * Redis 連不上時當作沒記住，照樣去問 upload-service。
 */
@Component
public class JobOwnerCache {

    private static final String PREFIX = "job-owner:";

    private final StringRedisTemplate redis;
    private final Duration ttl;

    public JobOwnerCache(StringRedisTemplate redis, @Value("${app.cache.job-owner-ttl}") Duration ttl) {
        this.redis = redis;
        this.ttl = ttl;
    }

    /** 記住的擁有者；沒記過（或 Redis 連不上）是 empty。 */
    public Optional<UUID> owner(String jobId) {
        return key(jobId).flatMap(key -> RedisFallback.orElse("job owner cache " + key, Optional.<UUID>empty(),
                () -> Optional.ofNullable(redis.opsForValue().get(key)).map(UUID::fromString)));
    }

    public void remember(String jobId, UUID owner) {
        key(jobId).ifPresent(key -> RedisFallback.orElse("job owner cache " + key, null, () -> {
            redis.opsForValue().set(key, owner.toString(), ttl);
            return null;
        }));
    }

    public void forget(String jobId) {
        key(jobId).ifPresent(key -> RedisFallback.orElse("job owner cache " + key, null, () -> redis.delete(key)));
    }

    private static Optional<String> key(String jobId) {
        try {
            return Optional.of(PREFIX + UUID.fromString(jobId));
        } catch (IllegalArgumentException e) {
            return Optional.empty();
        }
    }
}
