package com.transuai.gateway.web.dto;

// transcriptionLanguage：zh-TW（中文）、en（英文）、auto（自動偵測中文或英文）；null 是中文。
public record CompleteUploadRequestDto(
        String storagePath, String fileName, String fileType, long fileSizeBytes, int durationSeconds,
        String transcriptionLanguage) {
}
