package com.transuai.gateway.web.dto;

// 講者分離找出的一位講者。displayName 已經由 transcription-service 決定好（自訂名稱，否則「講者 N」），
// 前端直接顯示；displayOrder 從 1 開始，決定講者的顏色。
public record SpeakerDto(String label, String displayName, int displayOrder) {
}
