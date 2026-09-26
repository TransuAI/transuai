package com.transuai.gateway.web.dto;

// 同一個廠商、模型、金鑰來源的 LLM 用量；token 數是已知數字的加總，callsWithUnknownUsage 是廠商沒回報的呼叫次數。
public record LlmUsageSumDto(String provider, String model, String keySource, long inputTokens, long outputTokens,
        int calls, int callsWithUnknownUsage) {
}
