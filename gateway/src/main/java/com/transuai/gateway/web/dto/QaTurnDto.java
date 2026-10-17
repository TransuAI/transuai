package com.transuai.gateway.web.dto;

import java.time.Instant;
import java.util.List;

// modelProvider / model：回答這一則的模型，記錄模型之前的問答是 null。
// webSearch：這一題有沒有查網路；webSources：回答依據的網路來源，順序就是回答裡 [n] 的編號（搜尋失敗時是空的）。
public record QaTurnDto(String question, String answer, List<Double> sourceTimestamps, Instant createdAt,
        String modelProvider, String model, boolean webSearch, List<WebSourceDto> webSources) {
}
