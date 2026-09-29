package com.transuai.gateway.web.dto;

// applied（套用了，改名本身走 PATCH /transcripts/{jobId}/speakers/{label}）或 dismissed（忽略）。
public record SpeakerSuggestionStatusRequestDto(String status) {
}
