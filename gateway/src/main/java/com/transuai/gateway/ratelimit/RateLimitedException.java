package com.transuai.gateway.ratelimit;

/** 超過限流：回 429，{@code Retry-After} 是還要等幾秒。 */
public class RateLimitedException extends RuntimeException {

    private final long retryAfterSeconds;

    private RateLimitedException(String what, long retryAfterSeconds) {
        super("%s，請 %d 分鐘後再試".formatted(what, Math.max(1, (retryAfterSeconds + 59) / 60)));
        this.retryAfterSeconds = retryAfterSeconds;
    }

    /** 登入、註冊：猜密碼或大量註冊。 */
    public static RateLimitedException tooManyTries(long retryAfterSeconds) {
        return new RateLimitedException("嘗試太多次", retryAfterSeconds);
    }

    /** 其他 API：用得太頻繁。 */
    public static RateLimitedException tooFrequent(long retryAfterSeconds) {
        return new RateLimitedException("使用得太頻繁", retryAfterSeconds);
    }

    public long retryAfterSeconds() {
        return retryAfterSeconds;
    }
}
