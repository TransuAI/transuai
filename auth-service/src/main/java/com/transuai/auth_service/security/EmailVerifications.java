package com.transuai.auth_service.security;

import java.time.Duration;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.UUID;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.transuai.auth_service.domain.EmailVerificationToken;
import com.transuai.auth_service.repository.EmailVerificationTokenRepository;

/** 確認 email 的連結：跟重設密碼的一樣（256 bits、只存 SHA-256、一次性），{@code app.email-verification.ttl} 內有效；重寄時舊的作廢。 */
@Service
public class EmailVerifications {

    private final EmailVerificationTokenRepository repository;
    private final Duration ttl;

    public EmailVerifications(EmailVerificationTokenRepository repository,
            @Value("${app.email-verification.ttl}") Duration ttl) {
        this.repository = repository;
        this.ttl = ttl;
    }

    public Duration ttl() {
        return ttl;
    }

    @Transactional
    public String issue(UUID userId) {
        OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
        repository.useUpAllOf(userId, now);
        String token = OneTimeTokens.newToken();
        repository.save(EmailVerificationToken.builder()
                .id(UUID.randomUUID()).userId(userId).tokenHash(OneTimeTokens.sha256(token)).expiresAt(now.plus(ttl))
                .build());
        return token;
    }

    /** 有效就回傳它的使用者，並把這位使用者還沒用的都作廢；不然空的。 */
    @Transactional
    public Optional<UUID> useUp(String token) {
        OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
        Optional<EmailVerificationToken> stored = repository.findForUpdate(OneTimeTokens.sha256(token))
                .filter(found -> found.getUsedAt() == null && found.getExpiresAt().isAfter(now));
        stored.ifPresent(found -> repository.useUpAllOf(found.getUserId(), now));
        return stored.map(EmailVerificationToken::getUserId);
    }
}
