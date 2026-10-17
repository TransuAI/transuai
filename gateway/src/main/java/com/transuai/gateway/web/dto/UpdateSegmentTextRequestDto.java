package com.transuai.gateway.web.dto;

import jakarta.validation.constraints.Size;

public record UpdateSegmentTextRequestDto(@Size(max = 2000) String text) {
}
