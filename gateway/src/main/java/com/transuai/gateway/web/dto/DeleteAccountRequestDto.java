package com.transuai.gateway.web.dto;

import jakarta.validation.constraints.Size;

public record DeleteAccountRequestDto(@Size(max = 256) String password) {
}
