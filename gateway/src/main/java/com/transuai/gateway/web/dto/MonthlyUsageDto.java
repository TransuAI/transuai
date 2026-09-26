package com.transuai.gateway.web.dto;

import java.util.List;

// 一位使用者某個月（YYYY-MM，台灣時間）的用量：LLM 依模型與金鑰來源、轉錄依模型加總。
public record MonthlyUsageDto(String month, List<LlmUsageSumDto> llm, List<TranscriptionUsageSumDto> transcription) {
}
