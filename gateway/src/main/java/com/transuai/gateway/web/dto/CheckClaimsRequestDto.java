package com.transuai.gateway.web.dto;

import java.util.List;

import jakarta.validation.constraints.Size;

// 事實查核：使用者勾選要查的主張（每條查一次網路）。
public record CheckClaimsRequestDto(@Size(max = 100) List<@Size(max = 64) String> claimIds) {
}
