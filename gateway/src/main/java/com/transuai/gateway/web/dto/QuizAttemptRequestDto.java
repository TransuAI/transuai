package com.transuai.gateway.web.dto;

import java.util.List;

// 依題目順序，每題選的選項位置（從 0 開始）。
public record QuizAttemptRequestDto(List<Integer> answers) {
}
