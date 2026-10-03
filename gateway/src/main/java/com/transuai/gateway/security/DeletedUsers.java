package com.transuai.gateway.security;

import java.time.Duration;
import java.util.UUID;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

import com.transuai.gateway.redis.RedisFallback;

/**
 * 剛刪除帳號的使用者（存在 Redis）：access token 是 stateless 的，刪除之後最多還能用到過期（15 分鐘）——這段時間其他分頁或裝置
 * 照樣能呼叫 API，甚至建出新的 Job、留下沒人刪的資料。記住的時間跟 access token 一樣長，之後舊 token 自己過期了。Redis 連不上時
 * 當作沒記住（跟限流、快取一樣），這段空窗寫在 README。
 */
@Component
public class DeletedUsers {

    private static final String PREFIX = "deleted-user:";

    private final StringRedisTemplate redis;
    private final Duration ttl;

    public DeletedUsers(StringRedisTemplate redis, @Value("${app.auth.deleted-user-ttl}") Duration ttl) {
        this.redis = redis;
        this.ttl = ttl;
    }

    public void remember(UUID userId) {
        RedisFallback.run(PREFIX + userId, () -> redis.opsForValue().set(PREFIX + userId, "1", ttl));
    }

    public boolean isDeleted(UUID userId) {
        return RedisFallback.orElse(PREFIX + userId, false, () -> Boolean.TRUE.equals(redis.hasKey(PREFIX + userId)));
    }
}
