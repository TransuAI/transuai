package com.transuai.gateway.web.dto;

/** 登入、註冊、換發的回應。refresh token 不在這裡，在 httpOnly cookie（見 security/RefreshTokenCookie）。 */
public record AuthResponseDto(String accessToken, UserDto user) {
}
