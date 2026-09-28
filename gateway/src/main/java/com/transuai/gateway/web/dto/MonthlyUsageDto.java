package com.transuai.gateway.web.dto;

import java.util.List;

/** 一個月的用量，加上每月的上限（見 usage/UsageLimits；上限是現在的設定，看以前的月份也一樣）。 */
public record MonthlyUsageDto(String month, List<LlmUsageSumDto> llm, List<TranscriptionUsageSumDto> transcription,
        UsageLimitsDto limits) {

    public record UsageLimitsDto(int transcriptionMinutes, long platformTokens) {
    }
}
