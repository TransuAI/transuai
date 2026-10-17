package com.transuai.gateway;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Date;
import java.util.UUID;

import com.transuai.auth.grpc.v1.AuthResponse;
import com.transuai.auth.grpc.v1.User;
import com.transuai.gateway.security.JwtProperties;

import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;

/** 測試用的身分：跟 auth-service 簽發的一樣的 access token，與 auth-service 登入成功的回應。 */
public final class TestAuth {

    private TestAuth() {
    }

    /** 同一把密鑰、type=access，10 分鐘有效。 */
    public static String accessToken(JwtProperties jwt, UUID user) {
        return Jwts.builder().subject(user.toString()).claim("type", "access")
                .expiration(Date.from(Instant.now().plusSeconds(600)))
                .signWith(Keys.hmacShaKeyFor(jwt.secret().getBytes(StandardCharsets.UTF_8))).compact();
    }

    /** 跟 auth-service 簽的一樣帶 sid（哪一次登入）與 iat（什麼時候簽的）。 */
    public static String accessToken(JwtProperties jwt, UUID user, String sessionId, Instant issuedAt) {
        return Jwts.builder().subject(user.toString()).claim("type", "access").claim("sid", sessionId)
                .issuedAt(Date.from(issuedAt)).expiration(Date.from(Instant.now().plusSeconds(600)))
                .signWith(Keys.hmacShaKeyFor(jwt.secret().getBytes(StandardCharsets.UTF_8))).compact();
    }

    /** auth-service 登入（或註冊、換發）成功的回應。 */
    public static AuthResponse signedIn(String email) {
        return AuthResponse.newBuilder().setAccessToken("access").setRefreshToken("refresh")
                .setUser(User.newBuilder().setId("00000000-0000-0000-0000-000000000001").setEmail(email.trim()))
                .build();
    }
}
