package com.transuai.gateway.web.dto;

// provider 是 "platform" 時 model 可以省略。
public record SetDefaultModelRequestDto(String provider, String model) {
}
