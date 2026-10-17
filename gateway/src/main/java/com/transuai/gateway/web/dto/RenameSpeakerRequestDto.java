package com.transuai.gateway.web.dto;

import jakarta.validation.constraints.Size;

// name 空字串＝恢復預設名稱「講者 N」。
public record RenameSpeakerRequestDto(@Size(max = 100) String name) {
}
