package com.transuai.gateway.web.dto;

import java.util.List;

public record QaAnswerDto(String answer, List<Double> sourceTimestamps) {
}
