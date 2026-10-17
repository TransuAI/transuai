package com.transuai.gateway.security;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

import com.transuai.gateway.redis.RedisFallback;

/**
 * 還沒過期、但已經不能用的 access token（存在 Redis）。access token 是 stateless 的，作廢的只有 refresh token；沒有這個的話，登出、
 * 登出所有裝置、改密碼、刪除帳號之後，舊的 access token 最多還能用 15 分鐘（ASVS 3.3.1）。記住的時間跟 access token 一樣長，
 * 之後舊 token 自己過期了。三種：
 * <ul>
 * <li>登出：那一次登入（access token 的 {@code sid}）簽出的</li>
 * <li>登出所有裝置、改密碼：這位使用者在那一刻以前簽的（看 {@code iat}，秒）</li>
 * <li>刪除帳號：這位使用者的全部</li>
 * </ul>
 * 每個請求一次 Redis 呼叫（MGET）。Redis 連不上時當作沒記住（跟限流、快取一樣），這段空窗寫在 README。
 */
@Component
public class RevokedAccessTokens {

    private static final String DELETED_USER = "deleted-user:";
    private static final String SIGNED_OUT_BEFORE = "signed-out-before:";
    private static final String SIGNED_OUT_SESSION = "signed-out-session:";

    private final StringRedisTemplate redis;
    private final Duration ttl;

    public RevokedAccessTokens(StringRedisTemplate redis, @Value("${app.auth.revoked-token-ttl}") Duration ttl) {
        this.redis = redis;
        this.ttl = ttl;
    }

    /** 這次登入登出了。 */
    public void sessionEnded(String sessionId) {
        RedisFallback.run(SIGNED_OUT_SESSION + sessionId,
                () -> redis.opsForValue().set(SIGNED_OUT_SESSION + sessionId, "1", ttl));
    }

    /** 這位使用者在 before 以前簽的都不算了（登出所有裝置、改密碼）。before 要取在呼叫 auth-service 之前，之後簽的新 token 才不會被擋。 */
    public void sessionsEndedBefore(UUID userId, Instant before) {
        RedisFallback.run(SIGNED_OUT_BEFORE + userId,
                () -> redis.opsForValue().set(SIGNED_OUT_BEFORE + userId, String.valueOf(before.getEpochSecond()), ttl));
    }

    public void userDeleted(UUID userId) {
        RedisFallback.run(DELETED_USER + userId, () -> redis.opsForValue().set(DELETED_USER + userId, "1", ttl));
    }

    public boolean isRevoked(JwtService.AccessToken token) {
        List<String> keys = new ArrayList<>(List.of(DELETED_USER + token.userId(), SIGNED_OUT_BEFORE + token.userId()));
        if (token.sessionId() != null) {
            keys.add(SIGNED_OUT_SESSION + token.sessionId());
        }
        List<String> values = RedisFallback.orElse("revoked access tokens of " + token.userId(), null,
                () -> redis.opsForValue().multiGet(keys));
        if (values == null) {
            return false;
        }
        if (values.get(0) != null || (values.size() > 2 && values.get(2) != null)) {
            return true;
        }
        String before = values.get(1);
        // 沒有 iat 的 token（自己簽的才會沒有）當作很早以前簽的。
        return before != null && token.issuedAt().getEpochSecond() < Long.parseLong(before);
    }
}
