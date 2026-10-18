package com.transuai.gateway.security;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.UUID;

import javax.crypto.SecretKey;

import org.springframework.stereotype.Service;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.JwtException;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;

/**
 * 只驗證 access token（auth-service 簽發），用同一把 app.jwt.secret 本地驗章/驗效期，
 * 不會為了驗證每個請求就回頭呼叫 auth-service。refresh token 這個 Gateway 完全不解析，
 * POST /auth/refresh 只是把前端傳來的 refresh_token 原樣轉發給 AuthService.Refresh，
 * 誰簽的誰驗證。
 */
@Service
public class JwtService {

    private static final String CLAIM_TYPE = "type";
    private static final String TYPE_ACCESS = "access";
    private static final String CLAIM_SESSION = "sid";
    // 要先改密碼（auth-service 只在要改時帶，見它的 JwtService）。
    private static final String CLAIM_PASSWORD_CHANGE = "pwc";

    /**
     * 驗過的 access token：誰的、哪一次登入（sid；這個版本之前簽的沒有）、什麼時候簽的（沒有 iat 時是 EPOCH）、是不是要先改密碼
     *（安裝時建立的管理員）。
     */
    public record AccessToken(UUID userId, String sessionId, Instant issuedAt, boolean passwordChangeRequired) {
    }

    private final SecretKey key;

    public JwtService(JwtProperties properties) {
        this.key = Keys.hmacShaKeyFor(properties.secret().getBytes(StandardCharsets.UTF_8));
    }

    /** 驗證 access token 簽章/效期/type。任何問題都丟 {@link InvalidTokenException}。 */
    public AccessToken validateAccessToken(String accessToken) {
        Claims claims;
        try {
            claims = Jwts.parser().verifyWith(key).build().parseSignedClaims(accessToken).getPayload();
        } catch (JwtException | IllegalArgumentException e) {
            throw new InvalidTokenException("invalid or expired access token");
        }
        if (!TYPE_ACCESS.equals(claims.get(CLAIM_TYPE, String.class))) {
            throw new InvalidTokenException("not an access token");
        }
        UUID userId;
        try {
            userId = UUID.fromString(claims.getSubject());
        } catch (IllegalArgumentException | NullPointerException e) {
            throw new InvalidTokenException("invalid access token subject");
        }
        Instant issuedAt = claims.getIssuedAt() == null ? Instant.EPOCH : claims.getIssuedAt().toInstant();
        return new AccessToken(userId, claims.get(CLAIM_SESSION, String.class), issuedAt,
                Boolean.TRUE.equals(claims.get(CLAIM_PASSWORD_CHANGE, Boolean.class)));
    }
}
