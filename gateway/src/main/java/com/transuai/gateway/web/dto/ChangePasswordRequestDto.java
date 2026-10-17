package com.transuai.gateway.web.dto;

public record ChangePasswordRequestDto(String currentPassword, String newPassword) {
}
