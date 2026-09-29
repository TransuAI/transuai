package com.transuai.gateway.web.dto;

// 已知數字的加總；未知（null）的不算進去。webSearches：成功的網路搜尋次數。
public record UsageTotalsDto(long inputTokens, long outputTokens, double audioSeconds, long webSearches) {
}
