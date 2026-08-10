package com.transuai.gateway.web.dto;

import java.time.Instant;

public record PresignResponseDto(String uploadUrl, String storagePath, Instant expiresAt) {
}
