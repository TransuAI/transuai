package com.transuai.gateway.web.dto;

import java.util.List;

// revision：每次編輯逐字稿就 +1，用來比對 AI 產出（摘要/章節）依據的是不是最新的逐字稿。
public record TranscriptDto(String jobId, String language, String fullText, List<SegmentDto> segments,
        int revision) {
}
