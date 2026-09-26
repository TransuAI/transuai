package com.transuai.gateway.web.dto;

// questionCount 只能是 5、10、20（ai-service 驗證）。
public record QuizRequestDto(Integer questionCount) {
}
