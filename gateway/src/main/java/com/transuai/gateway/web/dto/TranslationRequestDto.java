package com.transuai.gateway.web.dto;

import jakarta.validation.constraints.Size;

// 翻譯逐字稿：目標語言（zh-TW / en / ja / ko）。
public record TranslationRequestDto(@Size(max = 10) String language) {
}
