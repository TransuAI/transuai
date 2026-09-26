package com.transuai.gateway.web.dto;

import java.time.Instant;
import java.util.List;

// 一份測驗（見 ai-service/CONTEXT.md「測驗」）。status：GENERATING / COMPLETED / FAILED（failureReason 是給使用者看的原因）。
// sourceRevision / modelProvider / model：依據的逐字稿 revision 與產生的模型，完成之前是 0 / null。
// questions 只有取得單一測驗時才有，列表裡是 null。
public record QuizDto(String id, String jobId, int questionCount, String status, String failureReason,
        int sourceRevision, String modelProvider, String model, Instant requestedAt, Instant completedAt,
        List<QuizQuestionDto> questions) {
}
