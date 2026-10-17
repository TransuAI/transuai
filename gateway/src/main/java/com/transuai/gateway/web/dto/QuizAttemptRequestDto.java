package com.transuai.gateway.web.dto;

import java.util.List;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

// 依題目順序，每題選的選項位置（從 0 開始）。
public record QuizAttemptRequestDto(@Size(max = 50) List<@NotNull @Min(0) @Max(10) Integer> answers) {
}
