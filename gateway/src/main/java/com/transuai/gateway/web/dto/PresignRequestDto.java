package com.transuai.gateway.web.dto;

public record PresignRequestDto(String fileName, String fileType, long fileSizeBytes) {
}
