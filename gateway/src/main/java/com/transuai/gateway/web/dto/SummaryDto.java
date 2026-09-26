package com.transuai.gateway.web.dto;

// sourceRevision：這份摘要（跟章節）依據的逐字稿 revision；小於逐字稿目前的 revision 就是過時。
// regenerationStatus：使用者要求重新產生之後的背景作業狀態，IDLE / RUNNING / FAILED。
// modelProvider / model：產生這份摘要（與章節）的模型，"platform" 是平台模型；記錄模型之前的摘要是 null。
public record SummaryDto(String jobId, String summaryText, int sourceRevision, String regenerationStatus,
        String modelProvider, String model) {
}
