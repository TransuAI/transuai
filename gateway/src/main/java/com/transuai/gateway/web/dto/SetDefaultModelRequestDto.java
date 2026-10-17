package com.transuai.gateway.web.dto;

import jakarta.validation.constraints.Size;

// provider 是 "platform" 時 model 可以省略。
public record SetDefaultModelRequestDto(@Size(max = 50) String provider, @Size(max = 200) String model) {
}
