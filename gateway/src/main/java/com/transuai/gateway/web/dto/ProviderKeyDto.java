package com.transuai.gateway.web.dto;

import java.time.Instant;

// 一把自有金鑰：只有末四碼，金鑰本身永遠不回傳。
public record ProviderKeyDto(String provider, String last4, Instant createdAt) {
}
