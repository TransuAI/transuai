package com.transuai.gateway.web.dto;

import java.time.Instant;

// 一個已連結的帳號（見 ai-service/CONTEXT.md）。service："google" / "notion"；status：CONNECTED / INVALID（已失效，要重新連結）
// / NOT_CONNECTED；connectedAt：連結的時間，未連結是 null。權杖永遠不會出現在這裡。
public record ConnectionDto(String service, String status, Instant connectedAt) {
}
