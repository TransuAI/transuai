package com.transuai.gateway.web.dto;

import jakarta.validation.constraints.Size;

public record VerifyEmailDto(@Size(max = 100) String token) {
}
