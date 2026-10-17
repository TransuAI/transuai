package com.transuai.gateway.web.dto;

import static com.transuai.gateway.web.dto.InputLimits.MAX_DURATION_SECONDS;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;

// durationSeconds：檔案長度（前端量的），拿來先確認這個月的轉錄用量上限放得下，省得傳完才被拒；舊的前端不送就是 null。
// contentType：檔案的 MIME 類型（File.type），簽進上傳網址，上傳時的 Content-Type 要一樣（upload-service 只收 audio/*、video/*）。
public record PresignRequestDto(@Size(max = 255) String fileName, @Size(max = 10) String fileType, @Positive long fileSizeBytes,
        @PositiveOrZero @Max(MAX_DURATION_SECONDS) Integer durationSeconds, @Size(max = 100) String contentType) {
}
