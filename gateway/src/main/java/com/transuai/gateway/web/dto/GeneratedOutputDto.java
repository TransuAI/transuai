package com.transuai.gateway.web.dto;

import java.time.Instant;

// 多格式輸出（見 ai-service/CONTEXT.md「多格式輸出」）的一份。status：GENERATING / COMPLETED / FAILED（failureReason 是給使用者看的原因）。
// content 是 Markdown，完成之前是 null。sourceRevision / model：依據的逐字稿 revision 與產生的模型，完成之前是 0 / null。
// editedAt：使用者改過內容的時間，沒改過是 null。platform：社群貼文的平台，其他格式是 null。
public record GeneratedOutputDto(String id, String jobId, String format, String platform, String instruction, String status,
        String failureReason, String content, int sourceRevision, String modelProvider, String model,
        Instant requestedAt, Instant completedAt, Instant editedAt) {
}
