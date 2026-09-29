package com.transuai.gateway.web.dto;

import java.util.List;

// 一個月的用量，加上每月的用量上限（見 usage/UsageLimits；上限是現在的設定，看以前的月份也一樣）。
// webSearches：這個月查網路的次數，成功與失敗分開（用量上限只算成功的）。
public record MonthlyUsageDto(String month, List<LlmUsageSumDto> llm, List<TranscriptionUsageSumDto> transcription,
        WebSearchesDto webSearches, UsageLimitsDto limits) {

    public record WebSearchesDto(long succeeded, long failed) {
    }

    public record UsageLimitsDto(int transcriptionMinutes, long platformTokens, int webSearches) {
    }
}
