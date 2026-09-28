package com.transuai.gateway.ratelimit;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.Locale;

import org.springframework.stereotype.Component;

import lombok.RequiredArgsConstructor;

/**
 * 登入與註冊的限流（防暴力破解）：每個 IP 的登入與註冊次數，加上同一個 IP 對同一個 email 的登入失敗次數。email 跟
 * auth-service 一樣先去空白、轉小寫，而且只把雜湊放進 Redis 的鍵，Redis 裡看不到誰的 email。
 */
@Component
@RequiredArgsConstructor
public class AuthRateLimits {

    private final RateLimiter limiter;
    private final RateLimitProperties properties;

    /** 登入前：這個 IP 的登入次數計一次；這個 IP 對這個 email 已經失敗太多次就不讓試。 */
    public void beforeLogin(String address, String email) {
        require(limiter.hit("login:ip:" + address, properties.login()));
        require(limiter.peek(failuresKey(address, email), properties.loginFailures()));
    }

    public void loginFailed(String address, String email) {
        limiter.hit(failuresKey(address, email), properties.loginFailures());
    }

    public void loginSucceeded(String address, String email) {
        limiter.reset(failuresKey(address, email));
    }

    public void beforeRegister(String address) {
        require(limiter.hit("register:ip:" + address, properties.register()));
    }

    private static void require(RateLimiter.Decision decision) {
        if (!decision.allowed()) {
            throw new RateLimitedException(decision.retryAfterSeconds());
        }
    }

    private static String failuresKey(String address, String email) {
        return "login-failures:" + sha256(address + "\n" + email.trim().toLowerCase(Locale.ROOT));
    }

    private static String sha256(String text) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is always available", e);
        }
    }
}
