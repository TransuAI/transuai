package com.transuai.auth_service.security;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.HexFormat;
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
 * 也會失敗、要重新登入）；只有剛換發的幾秒內例外（{@code refreshReuseGraceSeconds}，前端多個分頁同時換發）。
 */
@Service
@RequiredArgsConstructor
public class RefreshTokens {

    private final RefreshTokenRepository repository;
    private final JwtService jwtService;
    private final JwtProperties properties;

    /** 用 refresh token 換到的：誰的，與新的 refresh token。 */
    public record Exchange(UUID userId, String refreshToken) {
    }

    /** 登入或註冊：新的一串。 */
    @Transactional
    public String issue(UUID userId) {
        return issueInFamily(userId, UUID.randomUUID());
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
        return new Exchange(stored.getUserId(), issueInFamily(stored.getUserId(), stored.getFamilyId()));
    }

    /** 登出：這個 token 所在的那一串作廢。token 無效或不認得就什麼都不做（本來就不能用了）。 */
    @Transactional
    public void logout(String refreshToken) {
        JwtService.RefreshClaims claims;
        try {
            claims = jwtService.parseRefreshToken(refreshToken);
        } catch (StatusRuntimeException e) {
            return;
        }
        repository.findById(claims.tokenId())
                .filter(token -> token.getTokenHash().equals(sha256(refreshToken)))
                .ifPresent(token -> repository.revokeFamily(token.getFamilyId(), RevokedReason.LOGGED_OUT,
                        OffsetDateTime.now(ZoneOffset.UTC)));
    }

    /** 登出所有裝置。 */
    @Transactional
    public void logoutAll(UUID userId) {
        repository.revokeAllOf(userId, RevokedReason.LOGGED_OUT, OffsetDateTime.now(ZoneOffset.UTC));
    }

    private boolean justRotated(RefreshToken token, OffsetDateTime now) {
        return token.getRevokedReason() == RevokedReason.ROTATED
                && token.getRevokedAt().isAfter(now.minusSeconds(properties.refreshReuseGraceSeconds()));
    }

    private String issueInFamily(UUID userId, UUID familyId) {
        UUID id = UUID.randomUUID();
        Instant expiresAt = Instant.now().plus(properties.refreshTokenTtlDays(), ChronoUnit.DAYS);
        String token = jwtService.signRefreshToken(userId, id, expiresAt);
        repository.save(RefreshToken.builder()
                .id(id).userId(userId).familyId(familyId).tokenHash(sha256(token))
                .expiresAt(expiresAt.atOffset(ZoneOffset.UTC))
                .build());
        return token;
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
