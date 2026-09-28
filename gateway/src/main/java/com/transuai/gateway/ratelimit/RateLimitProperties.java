package com.transuai.gateway.ratelimit;

import java.time.Duration;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * 限流的上限（{@code app.rate-limit.*}），每條是「一段時間內最多幾次」。數字的由來見
 * .scratch/pre-launch-hardening/spec.md。
 *
 * @param loginFailures 同一個 IP 對同一個 email 登入失敗的次數（猜密碼）；登入成功就重算
 * @param login 同一個 IP 的登入嘗試（不分 email，換 email 猜也擋得到）
 * @param register 同一個 IP 的註冊
 */
@ConfigurationProperties(prefix = "app.rate-limit")
public record RateLimitProperties(Rule loginFailures, Rule login, Rule register) {

    public record Rule(int limit, Duration window) {
    }
}
