package com.transuai.gateway.web.dto;

public record QuizQuestionResultDto(int chosenOption, int correctOption, boolean correct, String explanation) {
}
