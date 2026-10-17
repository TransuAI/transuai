package com.transuai.gateway.web.dto;

import static com.transuai.gateway.web.dto.InputLimits.MAX_DURATION_SECONDS;

import java.util.List;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;

// 使用者寫的決策（新增或修改）：statement 必填；alternatives 是沒選的選項；proposedBy 是講者標籤（沒有＝不知道是誰）；startTime 只有新增時
// 用得到（修改不動時間點），沒有也可以。
public record DecisionInputDto(@Size(max = 300) String statement, @Size(max = 1000) String rationale,
        @Size(max = 10) List<@Size(max = 200) String> alternatives, @Size(max = 20) String proposedBy,
        Boolean tentative, @PositiveOrZero @Max(MAX_DURATION_SECONDS) Double startTime) {
}
