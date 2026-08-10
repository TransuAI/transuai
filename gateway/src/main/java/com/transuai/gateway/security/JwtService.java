package com.transuai.gateway.security;

import java.nio.charset.StandardCharsets;
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

    private final SecretKey key;

    public JwtService(JwtProperties properties) {
        this.key = Keys.hmacShaKeyFor(properties.secret().getBytes(StandardCharsets.UTF_8));
    }

    /** 驗證 access token 簽章/效期/type，回傳 user id。任何問題都丟 {@link InvalidTokenException}。 */
    public UUID validateAccessToken(String accessToken) {
        Claims claims;
        try {
            claims = Jwts.parser().verifyWith(key).build().parseSignedClaims(accessToken).getPayload();
        } catch (JwtException | IllegalArgumentException e) {
            throw new InvalidTokenException("invalid or expired access token");
        }
        if (!TYPE_ACCESS.equals(claims.get(CLAIM_TYPE, String.class))) {
            throw new InvalidTokenException("not an access token");
        }
        try {
            return UUID.fromString(claims.getSubject());
        } catch (IllegalArgumentException e) {
            throw new InvalidTokenException("invalid access token subject");
        }
    }
}
