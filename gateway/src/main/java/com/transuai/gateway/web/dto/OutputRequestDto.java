package com.transuai.gateway.web.dto;

// 產生一份多格式輸出：format（podcast_description…）與使用者的一句要求（可省略）。
public record OutputRequestDto(String format, String instruction) {
}
