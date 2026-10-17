package com.transuai.gateway.web.dto;

import java.time.Instant;
import java.util.List;

// status：RUNNING / COMPLETED / LIMIT_REACHED（到了工具呼叫次數或時間上限，已產生的提案保留）/ FAILED（原因在 failureReason；
// 執行中超過 5 分鐘也回報成 FAILED）。progress：執行中在做什麼；modelProvider / model：用哪個模型跑的。
public record PostMeetingRunDto(String id, String status, String progress, String failureReason, String modelProvider,
        String model, Instant requestedAt, Instant finishedAt, List<ActionProposalDto> proposals) {
}
