package com.transuai.gateway.ratelimit;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.Locale;
import java.util.function.Supplier;

import org.springframework.stereotype.Component;

import io.grpc.Status;
import io.grpc.StatusRuntimeException;
import lombok.RequiredArgsConstructor;

/**
 * 登入與註冊的限流（防暴力破解）：每個 IP 的登入與註冊次數，加上同一個 IP 對同一個 email 的登入失敗次數。email 跟
 * auth-service 一樣先去空白、轉小寫，而且只把雜湊放進 Redis 的鍵，Redis 裡看不到誰的 email。
 */
@Component
@RequiredArgsConstructor
public class AuthRateLimits {

    private static final String LOGIN_BY_ADDRESS = "login:ip:";
    private static final String REGISTER_BY_ADDRESS = "register:ip:";
    private static final String LOGIN_FAILURES = "login-failures:";

    private final RateLimiter limiter;
    private final RateLimitProperties properties;

    /**
     * 在限流之內登入：這個 IP 的登入次數計一次；這個 IP 對這個 email 的嘗試**先**計成一次失敗（同時送出的請求也只放得進
     * 上限那麼多次），登入成功就清掉，auth-service 沒回答（不是密碼錯）就退回這一次。
     */
    public <T> T login(String address, String email, Supplier<T> attempt) {
        require(limiter.hit(LOGIN_BY_ADDRESS + address, properties.login()));
        String failures = LOGIN_FAILURES + sha256(address + "\n" + email.trim().toLowerCase(Locale.ROOT));
        require(limiter.hit(failures, properties.loginFailures()));
        T result;
        try {
            result = attempt.get();
        } catch (StatusRuntimeException e) {
            if (e.getStatus().getCode() != Status.Code.UNAUTHENTICATED) {
                limiter.release(failures);
            }
            throw e;
        }
        limiter.reset(failures);
        return result;
    }

    public void beforeRegister(String address) {
        require(limiter.hit(REGISTER_BY_ADDRESS + address, properties.register()));
    }

    private static void require(RateLimiter.Decision decision) {
        if (!decision.allowed()) {
            throw new RateLimitedException(decision.retryAfterSeconds());
        }
    }

    private static String sha256(String text) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is always available", e);
        }
    }
}
