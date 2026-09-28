package com.transuai.gateway.usage;

/** 這個月的用量上限到了：回 429，{@code Retry-After} 是到下個月 1 日還有幾秒。 */
public class UsageLimitReachedException extends RuntimeException {

    private final long retryAfterSeconds;

    public UsageLimitReachedException(String message, long retryAfterSeconds) {
        super(message);
        this.retryAfterSeconds = retryAfterSeconds;
    }

    public long retryAfterSeconds() {
        return retryAfterSeconds;
    }
}
