package com.transuai.gateway.web.dto;

// durationSeconds：檔案長度（前端量的），拿來先確認這個月的轉錄用量上限放得下，省得傳完才被拒；舊的前端不送就是 null。
// contentType：檔案的 MIME 類型（File.type），簽進上傳網址，上傳時的 Content-Type 要一樣（upload-service 只收 audio/*、video/*）。
public record PresignRequestDto(String fileName, String fileType, long fileSizeBytes, Integer durationSeconds,
        String contentType) {
}
