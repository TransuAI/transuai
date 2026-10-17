package com.transuai.auth_service.security;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.HexFormat;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.transuai.auth_service.domain.RefreshToken;
import com.transuai.auth_service.domain.RefreshToken.RevokedReason;
import com.transuai.auth_service.repository.RefreshTokenRepository;

import io.grpc.Status;
import io.grpc.StatusRuntimeException;
import lombok.RequiredArgsConstructor;

/**
 * refresh token 的記錄、輪替與作廢（見 README「refresh token」）。每個簽出去的 token 在 refresh_tokens 有一列（只存雜湊）；每次換發
 * 就把舊的作廢、在同一串簽一個新的。已經換發過的又被用一次，表示有兩個人拿著同一個 token——視為被盜，整串作廢（正主下次換發
 * 也會失敗、要重新登入）；只有剛換發的幾秒內例外（{@code refreshReuseGraceSeconds}，前端多個分頁同時換發）。一串最多維持
 * {@code sessionMaxDays}：換發出來的 token 不會超過那一刻，之後要重新登入。
 */
@Service
@RequiredArgsConstructor
public class RefreshTokens {

    private final RefreshTokenRepository repository;
    private final JwtService jwtService;
    private final JwtProperties properties;

    /** 簽出的 refresh token 與它所在的那一串（這次登入，也是 access token 的 sid）。 */
    public record Issued(String refreshToken, UUID sessionId) {
    }

    /** 用 refresh token 換到的：誰的，與新的 refresh token。 */
    public record Exchange(UUID userId, Issued issued) {
    }

    /** 登入或註冊：新的一串。 */
    @Transactional
    public Issued issue(UUID userId) {
        UUID familyId = UUID.randomUUID();
        return new Issued(issueInFamily(userId, familyId, sessionEnd(Instant.now())), familyId);
    }

    /**
     * 換發：舊的作廢、同一串簽新的。無效、過期、登出了、或被當成被盜回 UNAUTHENTICATED；被盜時整串作廢（這個作廢在拋出例外之後仍然
     * 寫入）。
     */
    @Transactional(noRollbackFor = StatusRuntimeException.class)
    public Exchange exchange(String refreshToken) {
        JwtService.RefreshClaims claims = jwtService.parseRefreshToken(refreshToken);
        RefreshToken stored = repository.findForUpdate(claims.tokenId())
                .filter(token -> token.getTokenHash().equals(sha256(refreshToken)))
                .orElseThrow(() -> invalid("unknown refresh token"));
        OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
        if (stored.getRevokedAt() == null) {
            stored.setRevokedAt(now);
            stored.setRevokedReason(RevokedReason.ROTATED);
        } else if (!justRotated(stored, now)) {
            repository.revokeFamily(stored.getFamilyId(), RevokedReason.REUSED, now);
            throw invalid("refresh token was already used");
        }
        Instant familyEnd = stored.getFamilyExpiresAt() != null
                ? stored.getFamilyExpiresAt().toInstant()
                : sessionEnd(Instant.now());
        return new Exchange(stored.getUserId(), new Issued(
                issueInFamily(stored.getUserId(), stored.getFamilyId(), familyEnd), stored.getFamilyId()));
    }

    /** 登出：這個 token 所在的那一串作廢，回傳那一串的 id。token 無效或不認得就什麼都不做（本來就不能用了），回傳空的。 */
    @Transactional
    public Optional<UUID> logout(String refreshToken) {
        JwtService.RefreshClaims claims;
        try {
            claims = jwtService.parseRefreshToken(refreshToken);
        } catch (StatusRuntimeException e) {
            return Optional.empty();
        }
        Optional<RefreshToken> token = repository.findById(claims.tokenId())
                .filter(stored -> stored.getTokenHash().equals(sha256(refreshToken)));
        token.ifPresent(stored -> repository.revokeFamily(stored.getFamilyId(), RevokedReason.LOGGED_OUT,
                OffsetDateTime.now(ZoneOffset.UTC)));
        return token.map(RefreshToken::getFamilyId);
    }

    /**
     * 登出所有裝置；回傳 access token 可能還沒過期的那幾串（最近一個 access token 效期內簽過 token 的），gateway 讓那些 access token 也
     * 馬上不能用。
     */
    @Transactional
    public List<UUID> logoutAll(UUID userId) {
        OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
        List<UUID> recent = repository.familiesIssuedSince(userId, now.minusMinutes(properties.accessTokenTtlMinutes()));
        repository.revokeAllOf(userId, RevokedReason.LOGGED_OUT, now);
        return recent;
    }

    private boolean justRotated(RefreshToken token, OffsetDateTime now) {
        return token.getRevokedReason() == RevokedReason.ROTATED
                && token.getRevokedAt().isAfter(now.minusSeconds(properties.refreshReuseGraceSeconds()));
    }

    // 跟這一串的盡頭比，取早的：最後一次換發出來的 token 在那一刻過期，換發不了、要重新登入。
    private String issueInFamily(UUID userId, UUID familyId, Instant familyEnd) {
        UUID id = UUID.randomUUID();
        Instant ttlEnd = Instant.now().plus(properties.refreshTokenTtlDays(), ChronoUnit.DAYS);
        Instant expiresAt = ttlEnd.isBefore(familyEnd) ? ttlEnd : familyEnd;
        String token = jwtService.signRefreshToken(userId, id, expiresAt);
        repository.save(RefreshToken.builder()
                .id(id).userId(userId).familyId(familyId).tokenHash(sha256(token))
                .expiresAt(expiresAt.atOffset(ZoneOffset.UTC))
                .familyExpiresAt(familyEnd.atOffset(ZoneOffset.UTC))
                .build());
        return token;
    }

    private Instant sessionEnd(Instant signedInAt) {
        return signedInAt.plus(properties.sessionMaxDays(), ChronoUnit.DAYS);
    }

    private static StatusRuntimeException invalid(String description) {
        return Status.UNAUTHENTICATED.withDescription(description).asRuntimeException();
    }

    private static String sha256(String text) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is always available", e);
        }
    }
}
