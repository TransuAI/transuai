package com.transuai.gateway.web.dto;

import java.time.Instant;

public record UserDto(String id, String email, String displayName, Instant createdAt) {
}
