package com.transuai.gateway.web.dto;

import java.util.List;

public record TranscriptDto(String jobId, String language, String fullText, List<SegmentDto> segments) {
}
