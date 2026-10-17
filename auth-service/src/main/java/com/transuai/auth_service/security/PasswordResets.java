package com.transuai.auth_service.security;

import java.time.Duration;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.UUID;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.transuai.auth_service.domain.PasswordResetToken;
import com.transuai.auth_service.repository.PasswordResetTokenRepository;

/**
 * 忘記密碼的重設連結：256 bits 的隨機 token，只存 SHA-256；一次性、{@code app.password-reset.ttl} 內有效；同一位使用者申請新的
 * 時候之前還沒用的作廢。
 */
@Service
public class PasswordResets {

    private final PasswordResetTokenRepository repository;
    private final Duration ttl;

    public PasswordResets(PasswordResetTokenRepository repository, @Value("${app.password-reset.ttl}") Duration ttl) {
        this.repository = repository;
        this.ttl = ttl;
    }

    public Duration ttl() {
        return ttl;
    }

    /** 新的重設 token（給連結用），之前還沒用的作廢。 */
    @Transactional
    public String issue(UUID userId) {
        OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
        repository.useUpAllOf(userId, now);
        String token = OneTimeTokens.newToken();
        repository.save(PasswordResetToken.builder()
                .id(UUID.randomUUID()).userId(userId).tokenHash(OneTimeTokens.sha256(token)).expiresAt(now.plus(ttl))
                .build());
        return token;
    }

    /** 用掉這個 token：有效（沒過期、沒用過）就回傳它的使用者，並把這位使用者所有還沒用的作廢；不然空的。 */
    @Transactional
    public Optional<UUID> useUp(String token) {
        OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
        Optional<PasswordResetToken> stored = repository.findForUpdate(OneTimeTokens.sha256(token))
                .filter(found -> found.getUsedAt() == null && found.getExpiresAt().isAfter(now));
        stored.ifPresent(found -> repository.useUpAllOf(found.getUserId(), now));
        return stored.map(PasswordResetToken::getUserId);
    }
}
