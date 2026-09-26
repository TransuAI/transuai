package com.transuai.gateway.web.dto;

// 已知數字的加總；未知（null）的不算進去。
public record UsageTotalsDto(long inputTokens, long outputTokens, double audioSeconds) {
}
