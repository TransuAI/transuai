package com.transuai.gateway.web.dto;

public record PasswordResetConfirmDto(String token, String newPassword) {
}
