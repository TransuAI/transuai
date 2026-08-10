package com.transuai.gateway.web.dto;

public record AuthResponseDto(String accessToken, String refreshToken, UserDto user) {
}
