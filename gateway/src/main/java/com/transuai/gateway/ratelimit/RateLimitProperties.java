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
 * @param perUser 登入的使用者，所有 API 合計
 * @param perAddress 沒登入的請求（登入、註冊、換發 token、OAuth 回呼……），每個 IP 合計
 * @param upload 完成上傳（每次都觸發要付費的轉錄），每人
 * @param question 問答（每題都呼叫 AI），每人
 * @param quiz 產生測驗，每人
 * @param regenerate 重新產生摘要與章節，每人
 * @param postMeeting 開始會後處理（一次最多 10 次 AI 呼叫），每人
 * @param providerKey 存自有金鑰（每次都向 AI 廠商驗證：不讓人拿平台去試偷來的金鑰），每人
 */
@ConfigurationProperties(prefix = "app.rate-limit")
public record RateLimitProperties(Rule loginFailures, Rule login, Rule register, Rule perUser, Rule perAddress,
        Rule upload, Rule question, Rule quiz, Rule regenerate, Rule postMeeting, Rule providerKey) {

    public record Rule(int limit, Duration window) {
    }
}
