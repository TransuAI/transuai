package com.transuai.gateway.web.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;

// questionCount 只能是 5、10、20（ai-service 驗證）。
public record QuizRequestDto(@Min(1) @Max(50) Integer questionCount) {
}
