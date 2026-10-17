package com.transuai.auth_service.security;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Date;
import java.util.UUID;

import javax.crypto.SecretKey;

import org.springframework.stereotype.Service;

import io.grpc.Status;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.JwtException;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;

/**
 * 簽發 access/refresh token。access token 只在這裡簽發，驗證交給 Gateway（用同一把 secret
 * 本地驗章，不會每個請求都回頭呼叫這個服務）——這裡只負責驗證自己簽出去、拿來換發新 token 的
 * refresh token（見 {@link #parseRefreshToken}）；refresh token 的記錄、輪替與作廢在 {@link RefreshTokens}。
 */
@Service
public class JwtService {

    private static final String CLAIM_TYPE = "type";
    private static final String TYPE_ACCESS = "access";
    private static final String TYPE_REFRESH = "refresh";
    private static final String CLAIM_EMAIL = "email";
    private static final String CLAIM_SESSION = "sid";

    private final SecretKey key;
    private final JwtProperties properties;

    public JwtService(JwtProperties properties) {
        this.properties = properties;
        this.key = Keys.hmacShaKeyFor(properties.secret().getBytes(StandardCharsets.UTF_8));
    }

    /** refresh token 裡帶的：誰的、哪一個（jti，對到 refresh_tokens 的一列）。 */
    public record RefreshClaims(UUID userId, UUID tokenId) {
    }

    /** sessionId：這次登入（refresh token 的那一串）；登出時 gateway 依它讓這串簽出的 access token 馬上失效。 */
    public String issueAccessToken(UUID userId, String email, UUID sessionId) {
        Instant now = Instant.now();
        return Jwts.builder()
                .subject(userId.toString())
                .claim(CLAIM_TYPE, TYPE_ACCESS)
                .claim(CLAIM_EMAIL, email)
                .claim(CLAIM_SESSION, sessionId.toString())
                .issuedAt(Date.from(now))
                .expiration(Date.from(now.plus(properties.accessTokenTtlMinutes(), ChronoUnit.MINUTES)))
                .signWith(key)
                .compact();
    }

    /** 簽一個 refresh token；記錄與作廢在 {@link RefreshTokens}。 */
    public String signRefreshToken(UUID userId, UUID tokenId, Instant expiresAt) {
        return Jwts.builder()
                .id(tokenId.toString())
                .subject(userId.toString())
                .claim(CLAIM_TYPE, TYPE_REFRESH)
                .issuedAt(new Date())
                .expiration(Date.from(expiresAt))
                .signWith(key)
                .compact();
    }

    /**
     * 驗證 refresh token 簽章/效期/type，回傳誰的、哪一個。無效一律回 UNAUTHENTICATED，不細分原因；這個版本之前簽的（沒有 jti）也是
     * 無效——作廢機制上線時所有人要重新登入一次。
     */
    public RefreshClaims parseRefreshToken(String refreshToken) {
        Claims claims;
        try {
            claims = Jwts.parser().verifyWith(key).build().parseSignedClaims(refreshToken).getPayload();
        } catch (JwtException | IllegalArgumentException e) {
            throw Status.UNAUTHENTICATED.withDescription("invalid or expired refresh token").asRuntimeException();
        }
        if (!TYPE_REFRESH.equals(claims.get(CLAIM_TYPE, String.class))) {
            throw Status.UNAUTHENTICATED.withDescription("not a refresh token").asRuntimeException();
        }
        try {
            return new RefreshClaims(UUID.fromString(claims.getSubject()), UUID.fromString(claims.getId()));
        } catch (IllegalArgumentException | NullPointerException e) {
            throw Status.UNAUTHENTICATED.withDescription("invalid refresh token").asRuntimeException();
        }
    }
}
