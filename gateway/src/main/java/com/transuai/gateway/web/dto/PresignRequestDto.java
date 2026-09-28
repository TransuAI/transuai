package com.transuai.gateway.web.dto;

// durationSeconds：檔案長度（前端量的），拿來先確認這個月的轉錄用量上限放得下，省得傳完才被拒；舊的前端不送就是 null。
public record PresignRequestDto(String fileName, String fileType, long fileSizeBytes, Integer durationSeconds) {
}
