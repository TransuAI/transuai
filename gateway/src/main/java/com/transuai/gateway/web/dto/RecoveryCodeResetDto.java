package com.transuai.gateway.web.dto;

import jakarta.validation.constraints.Size;

public record RecoveryCodeResetDto(@Size(max = 254) String email, @Size(max = 40) String code,
        @Size(max = 256) String newPassword) {
}
