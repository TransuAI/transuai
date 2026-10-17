package com.transuai.gateway.web.dto;

import jakarta.validation.constraints.Size;

public record ChangePasswordRequestDto(@Size(max = 256) String currentPassword, @Size(max = 256) String newPassword) {
}
