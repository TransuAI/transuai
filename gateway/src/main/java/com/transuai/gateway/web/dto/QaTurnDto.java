package com.transuai.gateway.web.dto;

import java.time.Instant;
import java.util.List;

// modelProvider / model：回答這一則的模型，記錄模型之前的問答是 null。
public record QaTurnDto(String question, String answer, List<Double> sourceTimestamps, Instant createdAt,
        String modelProvider, String model) {
}
