package com.transuai.gateway.web.dto;

import java.util.List;

// 一次作答的結果：答對幾題、每題的結果（依題目順序）。
public record QuizAttemptResultDto(int correctCount, int questionCount, List<QuizQuestionResultDto> results) {
}
