package com.transuai.gateway.ratelimit;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.Locale;
import java.util.UUID;
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
    private static final String PASSWORD_RESET_BY_ADDRESS = "password-reset:ip:";
    private static final String PASSWORD_RESET_BY_EMAIL = "password-reset:email:";
    private static final String PASSWORD_RESET_CONFIRM_BY_ADDRESS = "password-reset-confirm:ip:";
    private static final String RECOVERY_CODE_BY_ADDRESS = "recovery-code:ip:";
    private static final String RECOVERY_CODE_FAILURES = "recovery-code-failures:";
    private static final String LOGIN_FAILURES = "login-failures:";
    // 刪除帳號與改密碼共用：兩邊都在猜同一個密碼。
    private static final String PASSWORD_CHECK_FAILURES = "password-check-failures:";

    private final RateLimiter limiter;
    private final RateLimitProperties properties;

    /**
     * 在限流之內登入：這個 IP 的登入次數計一次；這個 IP 對這個 email 的嘗試**先**計成一次失敗（同時送出的請求也只放得進
     * 上限那麼多次），登入成功就清掉，auth-service 沒回答（不是密碼錯）就退回這一次。
     */
    public <T> T login(String address, String email, Supplier<T> attempt) {
        limiter.hit(LOGIN_BY_ADDRESS + address, properties.login()).orThrow(RateLimitedException::tooManyTries);
        String failures = LOGIN_FAILURES + sha256(address + "\n" + email.trim().toLowerCase(Locale.ROOT));
        limiter.hit(failures, properties.loginFailures()).orThrow(RateLimitedException::tooManyTries);
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

    /**
     * 刪除帳號與改密碼要再輸入一次目前的密碼：拿到別人開著的瀏覽器也不能一直猜。跟登入失敗同一個上限，算的是這位使用者的失敗次數
     * （兩個功能合計；密碼錯是 auth-service 的 PERMISSION_DENIED）；成功或 auth-service 沒回答就不算。
     */
    public <T> T withPasswordCheck(UUID userId, Supplier<T> attempt) {
        String failures = PASSWORD_CHECK_FAILURES + userId;
        limiter.hit(failures, properties.loginFailures()).orThrow(RateLimitedException::tooManyTries);
        T result;
        try {
            result = attempt.get();
        } catch (StatusRuntimeException e) {
            if (e.getStatus().getCode() != Status.Code.PERMISSION_DENIED) {
                limiter.release(failures);
            }
            throw e;
        }
        limiter.reset(failures);
        return result;
    }

    public void beforeRegister(String address) {
        limiter.hit(REGISTER_BY_ADDRESS + address, properties.register()).orThrow(RateLimitedException::tooManyTries);
    }

    /** 申請重設密碼：每個 IP 的次數，加上每個 email 的次數（不讓人一直寄信轟炸同一個信箱；email 只放雜湊）。 */
    public void beforePasswordReset(String address, String email) {
        limiter.hit(PASSWORD_RESET_BY_ADDRESS + address, properties.passwordReset()).orThrow(RateLimitedException::tooManyTries);
        beforeMailTo(email.trim().toLowerCase(Locale.ROOT));
    }

    /** 會寄信給某個人的請求（重設連結、重寄確認信）：同一個收件人每小時的上限。who 只放雜湊。 */
    public void beforeMailTo(String who) {
        limiter.hit(PASSWORD_RESET_BY_EMAIL + sha256(who), properties.passwordResetPerEmail()).orThrow(RateLimitedException::tooManyTries);
    }

    /**
     * 用復原碼重設密碼：跟登入一樣——這個 IP 的次數，加上這個 IP 對這個 email 猜錯的次數（先計成一次失敗，成功清掉；猜錯是 auth-service 的
     * FAILED_PRECONDITION，其他錯誤退回）。
     */
    public <T> T withRecoveryCode(String address, String email, Supplier<T> attempt) {
        limiter.hit(RECOVERY_CODE_BY_ADDRESS + address, properties.login()).orThrow(RateLimitedException::tooManyTries);
        String failures = RECOVERY_CODE_FAILURES + sha256(address + "\n" + email.trim().toLowerCase(Locale.ROOT));
        limiter.hit(failures, properties.loginFailures()).orThrow(RateLimitedException::tooManyTries);
        T result;
        try {
            result = attempt.get();
        } catch (StatusRuntimeException e) {
            if (e.getStatus().getCode() != Status.Code.FAILED_PRECONDITION) {
                limiter.release(failures);
            }
            throw e;
        }
        limiter.reset(failures);
        return result;
    }

    /** 用重設連結設新密碼：每個 IP 跟登入一樣的上限（token 有 256 bits，猜不到；這是多一層）。 */
    public void beforePasswordResetConfirm(String address) {
        limiter.hit(PASSWORD_RESET_CONFIRM_BY_ADDRESS + address, properties.login()).orThrow(RateLimitedException::tooManyTries);
    }

    private static String sha256(String text) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is always available", e);
        }
    }
}
