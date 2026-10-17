package com.transuai.gateway.web.dto;

import static com.transuai.gateway.web.dto.InputLimits.MAX_DURATION_SECONDS;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;

// timeSeconds、text、source 都可以省略（但時間與文字不能都沒有，upload-service 會回 400）；source 預設 manual。
public record CreateNoteRequestDto(@PositiveOrZero @Max(MAX_DURATION_SECONDS) Double timeSeconds, @Size(max = 2000) String text,
        @Pattern(regexp = "manual|qa") String source) {
}
