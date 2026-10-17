package com.transuai.gateway.web.dto;

import static com.transuai.gateway.web.dto.InputLimits.MAX_DURATION_SECONDS;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;

// transcriptionLanguage：zh-TW（中文）、en（英文）、auto（自動偵測中文或英文）；null 是中文。
public record CompleteUploadRequestDto(
        @Size(max = 512) String storagePath, @Size(max = 255) String fileName, @Size(max = 10) String fileType,
        @Positive long fileSizeBytes, @PositiveOrZero @Max(MAX_DURATION_SECONDS) int durationSeconds,
        @Pattern(regexp = "zh-TW|en|auto") String transcriptionLanguage) {
}
