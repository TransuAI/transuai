package com.transuai.gateway.web.dto;

import jakarta.validation.constraints.Size;

public record PasswordResetRequestDto(@Size(max = 254) String email) {
}
