package com.transuai.gateway.ratelimit;

/** 超過限流：回 429，{@code Retry-After} 是還要等幾秒。 */
public class RateLimitedException extends RuntimeException {

    private final long retryAfterSeconds;

    public RateLimitedException(long retryAfterSeconds) {
        super("嘗試太多次，請 %d 分鐘後再試".formatted(Math.max(1, (retryAfterSeconds + 59) / 60)));
        this.retryAfterSeconds = retryAfterSeconds;
    }

    public long retryAfterSeconds() {
        return retryAfterSeconds;
    }
}
