package com.transuai.gateway.web.dto;

import jakarta.validation.constraints.Size;

public record PasswordResetConfirmDto(@Size(max = 100) String token, @Size(max = 256) String newPassword) {
}
