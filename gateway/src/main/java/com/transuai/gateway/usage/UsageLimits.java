package com.transuai.gateway.usage;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * 每位使用者每月的用量上限（{@code app.usage-limits.*}，月份依台灣時間）。限流管的是短時間的頻率，這裡管一個月的總量：
 * 轉錄與平台模型的費用由平台付。自有金鑰的 AI 呼叫是使用者自己付，不算。
 *
 * @param transcriptionMinutes 轉錄的分鐘數；用完就不能上傳（這個月已經上傳的照樣轉錄完）
 * @param platformTokens 平台模型的 token（輸入加輸出）；用完就不能用平台模型問答、出題、重新產生摘要、跑會後處理，改用自有金鑰
 *        的模型可以
 */
@ConfigurationProperties(prefix = "app.usage-limits")
public record UsageLimits(int transcriptionMinutes, long platformTokens) {
}
