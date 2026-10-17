package com.transuai.gateway.web.dto;

import jakarta.validation.constraints.Size;

// 使用者修改一份多格式輸出的內容（Markdown）。
public record OutputUpdateDto(@Size(max = 20000) String content) {
}
