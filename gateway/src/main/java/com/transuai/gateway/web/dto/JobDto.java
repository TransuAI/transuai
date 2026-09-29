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
        String transcriptionLanguage,
        // 標題（AI 依內容取的或使用者改的）；null 是沒有標題，顯示檔名
        String title,
        // meeting、lecture、interview、podcast、video、other；null 是還沒判斷
        String category) {
}
