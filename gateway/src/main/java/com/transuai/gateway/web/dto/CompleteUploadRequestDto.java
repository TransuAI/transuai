package com.transuai.gateway.web.dto;

public record CompleteUploadRequestDto(
        String storagePath, String fileName, String fileType, long fileSizeBytes, int durationSeconds) {
}
