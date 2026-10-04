package com.transuai.gateway.web.dto;

import java.util.List;

// 使用者寫的決策（新增或修改）：statement 必填；alternatives 是沒選的選項；proposedBy 是講者標籤（沒有＝不知道是誰）；startTime 只有新增時
// 用得到（修改不動時間點），沒有也可以。
public record DecisionInputDto(String statement, String rationale, List<String> alternatives, String proposedBy,
        Boolean tentative, Double startTime) {
}
