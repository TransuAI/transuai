package com.transuai.gateway.web.dto;

import java.util.List;

// kind："multiple_choice"（4 個選項）或 "true_false"（選項是「是」「否」）；correctOption 是正確選項的位置（從 0 開始）；
// sourceTimestamps 是依據的片段開始時間（秒）。
public record QuizQuestionDto(String kind, String prompt, List<String> options, int correctOption, String explanation,
        List<Double> sourceTimestamps) {
}
