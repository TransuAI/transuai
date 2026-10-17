package com.transuai.gateway.web.dto;

// revoked：有沒有成功向對方撤銷授權（沒有的話權杖一樣已刪除，使用者可以到對方的帳號設定手動移除）。
public record DeleteConnectionResponseDto(boolean revoked) {
}
