package com.transuai.gateway.web.dto;

import java.util.List;

// 事實查核：使用者勾選要查的主張（每條查一次網路）。
public record CheckClaimsRequestDto(List<String> claimIds) {
}
