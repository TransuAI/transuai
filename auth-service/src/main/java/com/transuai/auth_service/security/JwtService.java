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
 * refresh token（見 {@link #parseRefreshToken}）。
 */
@Service
public class JwtService {

    private static final String CLAIM_TYPE = "type";
    private static final String TYPE_ACCESS = "access";
    private static final String TYPE_REFRESH = "refresh";
    private static final String CLAIM_EMAIL = "email";

    private final SecretKey key;
    private final JwtProperties properties;

    public JwtService(JwtProperties properties) {
        this.properties = properties;
        this.key = Keys.hmacShaKeyFor(properties.secret().getBytes(StandardCharsets.UTF_8));
    }

    public record IssuedTokens(String accessToken, String refreshToken) {
    }

    public IssuedTokens issueTokens(UUID userId, String email) {
        return new IssuedTokens(issueAccessToken(userId, email), issueRefreshToken(userId));
    }

    private String issueAccessToken(UUID userId, String email) {
        Instant now = Instant.now();
        return Jwts.builder()
                .subject(userId.toString())
                .claim(CLAIM_TYPE, TYPE_ACCESS)
                .claim(CLAIM_EMAIL, email)
                .issuedAt(Date.from(now))
                .expiration(Date.from(now.plus(properties.accessTokenTtlMinutes(), ChronoUnit.MINUTES)))
                .signWith(key)
                .compact();
    }

    private String issueRefreshToken(UUID userId) {
        Instant now = Instant.now();
        return Jwts.builder()
                .subject(userId.toString())
                .claim(CLAIM_TYPE, TYPE_REFRESH)
                .issuedAt(Date.from(now))
                .expiration(Date.from(now.plus(properties.refreshTokenTtlDays(), ChronoUnit.DAYS)))
                .signWith(key)
                .compact();
    }

    /** 驗證 refresh token 簽章/效期/type，回傳 user id。無效一律回 UNAUTHENTICATED，不細分原因。 */
    public UUID parseRefreshToken(String refreshToken) {
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
            return UUID.fromString(claims.getSubject());
        } catch (IllegalArgumentException e) {
            throw Status.UNAUTHENTICATED.withDescription("invalid refresh token subject").asRuntimeException();
        }
    }
}
