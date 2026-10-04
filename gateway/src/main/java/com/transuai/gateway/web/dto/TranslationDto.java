package com.transuai.gateway.web.dto;

import java.time.Instant;
import java.util.List;

// 譯文（見 ai-service/CONTEXT.md「譯文」）：一個 Job 一種語言一份。status：GENERATING / COMPLETED / FAILED（failureReason 是給使用者看的
// 原因；已經翻好的片段保留）。totalSegments / translatedSegments 是進度。segments 只有取得一種語言時才有，列表裡是 null。
public record TranslationDto(String language, String status, String failureReason, int totalSegments,
        int translatedSegments, String modelProvider, String model, Instant requestedAt, Instant completedAt,
        List<Segment> segments) {

    // 一個片段的譯文：segmentId 對到逐字稿的片段。
    public record Segment(String segmentId, String text) {
    }
}
