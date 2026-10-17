package com.transuai.gateway.web.dto;

import jakarta.validation.constraints.Size;

public record RegisterRequestDto(@Size(max = 254) String email, @Size(max = 256) String password,
        @Size(max = 100) String displayName) {
}
