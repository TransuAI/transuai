package com.transuai.gateway.web.dto;

// 產生一份多格式輸出：format（podcast_description…）、使用者的一句要求（可省略）、社群貼文的平台（social_post 才需要）。
public record OutputRequestDto(String format, String instruction, String platform) {
}
