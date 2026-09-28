package com.transuai.gateway.ratelimit;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * 標在 controller 方法上：這個 API 會花錢或用掉外部服務的額度（轉錄、AI、付費的 embedding、Google／Notion），除了所有 API 共用的
 * 上限，每人另外有 {@code app.rate-limit.costly.<value>} 的上限（見 {@link ApiRateLimits}）。同一個 value 的 API 共用一個計數。
 */
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface CostlyFeature {

    /** 設定裡的名稱，也是 Redis 計數鍵的一部分，例如 {@code question}。 */
    String value();
}
