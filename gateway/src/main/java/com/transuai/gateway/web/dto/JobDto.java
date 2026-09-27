package com.transuai.gateway.web.dto;

import java.time.Instant;

public record JobDto(
        String jobId,
        String userId,
        String fileName,
        String fileType,
        long fileSizeBytes,
        String storagePath,
        int durationSeconds,
        String status,
        String errorReason,
        Instant createdAt,
        Instant updatedAt,
        // zh-TW（中文）、en（英文）、auto（自動偵測）
        String transcriptionLanguage) {
}
