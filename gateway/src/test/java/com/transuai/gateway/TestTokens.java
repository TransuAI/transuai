package com.transuai.gateway;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Date;
import java.util.UUID;

import com.transuai.gateway.security.JwtProperties;

import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;

/** 測試用的 access token：跟 auth-service 簽發的一樣（同一把密鑰、type=access），10 分鐘有效。 */
public final class TestTokens {

    private TestTokens() {
    }

    public static String accessToken(JwtProperties jwt, UUID user) {
        return Jwts.builder().subject(user.toString()).claim("type", "access")
                .expiration(Date.from(Instant.now().plusSeconds(600)))
                .signWith(Keys.hmacShaKeyFor(jwt.secret().getBytes(StandardCharsets.UTF_8))).compact();
    }
}
