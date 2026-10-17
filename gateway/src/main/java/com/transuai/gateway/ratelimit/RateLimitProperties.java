package com.transuai.gateway.ratelimit;

import java.time.Duration;
import java.util.Map;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * 限流的上限（{@code app.rate-limit.*}），每條是「一段時間內最多幾次」。數字的由來見
 * .scratch/pre-launch-hardening/spec.md 與 gateway README「限流」。
 *
 * @param loginFailures 同一個 IP 對同一個 email 登入失敗的次數（猜密碼）；登入成功就重算
 * @param login 同一個 IP 的登入嘗試（不分 email，換 email 猜也擋得到）
 * @param register 同一個 IP 的註冊
 * @param perUser 登入的使用者，所有 API 合計
 * @param perAddress 沒登入（或 token 無效）的請求，每個 IP 合計
 * @param costly 花錢的功能，名稱（{@link CostlyFeature#value()}）→ 每人的上限
 */
@ConfigurationProperties(prefix = "app.rate-limit")
public record RateLimitProperties(Rule loginFailures, Rule login, Rule register, Rule passwordReset,
        Rule passwordResetPerEmail, Rule perUser, Rule perAddress, Map<String, Rule> costly) {

    public record Rule(int limit, Duration window) {
    }
}
