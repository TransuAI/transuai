package com.transuai.gateway.web.dto;

// 會後處理（見 ai-service/CONTEXT.md）：這位使用者能不能對這個 Job 跑（不能的話 unavailableReason 是給使用者看的原因），
// 與最新一份紀錄（還沒跑過是 null）。
public record PostMeetingDto(boolean available, String unavailableReason, PostMeetingRunDto latestRun) {
}
