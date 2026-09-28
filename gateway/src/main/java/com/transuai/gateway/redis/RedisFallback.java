package com.transuai.gateway.redis;

import java.util.function.Supplier;

import org.springframework.dao.DataAccessException;

import lombok.extern.slf4j.Slf4j;

/**
 * Redis 只是輔助（限流的計數、快取）：連不上時照常服務，不讓 Redis 故障把所有人擋在外面，只記 log。
 */
@Slf4j
public final class RedisFallback {

    private RedisFallback() {
    }

    /** 做 work；Redis 連不上就回 whenUnavailable。what 是記 log 用的說明（例如哪個鍵）。 */
    public static <T> T orElse(String what, T whenUnavailable, Supplier<T> work) {
        try {
            return work.get();
        } catch (DataAccessException e) {
            log.warn("{} skipped, Redis unavailable: {}", what, e.getMessage());
            return whenUnavailable;
        }
    }

    /** 做 work（沒有回傳值的）；Redis 連不上就略過。 */
    public static void run(String what, Runnable work) {
        orElse(what, null, () -> {
            work.run();
            return null;
        });
    }
}
