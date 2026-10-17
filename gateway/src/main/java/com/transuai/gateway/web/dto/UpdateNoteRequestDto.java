package com.transuai.gateway.web.dto;

import jakarta.validation.constraints.Size;

public record UpdateNoteRequestDto(@Size(max = 2000) String text) {
}
