package com.transuai.gateway.web.dto;

import java.time.Instant;

public record MediaUrlDto(String downloadUrl, Instant expiresAt) {
}
