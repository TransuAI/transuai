package com.transuai.gateway.web.dto;

import jakarta.validation.constraints.Size;

public record RecoveryCodesRequestDto(@Size(max = 256) String currentPassword) {
}
