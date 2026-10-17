package com.transuai.gateway.web.dto;

// 同一個廠商、模型的轉錄用量；audioSeconds 是已知秒數的加總，callsWithUnknownUsage 是服務沒回報的呼叫次數。
public record TranscriptionUsageSumDto(String provider, String model, double audioSeconds, int calls,
        int callsWithUnknownUsage) {
}
