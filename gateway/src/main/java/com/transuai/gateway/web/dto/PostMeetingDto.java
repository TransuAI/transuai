package com.transuai.gateway.web.dto;

import java.util.List;

// 會後處理（見 ai-service/CONTEXT.md）：這位使用者能不能對這個 Job 跑（不能的話 unavailableReason 是給使用者看的原因），
// 最新一份紀錄（還沒跑過是 null）、提示（能跑但有些事做不到，例如還沒指定 Notion 的位置），以及之前的紀錄（新的在前）。
public record PostMeetingDto(boolean available, String unavailableReason, PostMeetingRunDto latestRun, List<String> hints,
        List<PostMeetingRunDto> earlierRuns) {
}
