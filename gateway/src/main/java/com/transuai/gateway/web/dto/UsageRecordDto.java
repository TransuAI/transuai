package com.transuai.gateway.web.dto;

import java.time.Instant;

// 一次計費呼叫的用量（見 ai-service/CONTEXT.md「用量」）。kind 是 "llm"（token）、"transcription"（音檔秒數）或
// "web_search"（一次網路搜尋，沒有數字；model 是空字串）；
// 廠商沒回報的數字是 null（未知），不是 0。keySource 是 "platform"（平台模型）或 "own_key"（自有金鑰）。
public record UsageRecordDto(String kind, String feature, String provider, String model, String keySource,
        Integer inputTokens, Integer outputTokens, Double audioSeconds, boolean succeeded, Instant createdAt) {
}
