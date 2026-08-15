package com.transuai.gateway.web.dto;

import java.time.Instant;
import java.util.List;

public record QaTurnDto(String question, String answer, List<Double> sourceTimestamps, Instant createdAt) {
}
