package com.transuai.gateway.web.dto;

import java.time.Instant;
import java.util.List;

// 跨 Job 的決策（決策頁）：每個決策帶它所在的 Job。沒有搜尋時依 Job 的建立時間由新到舊、同一個 Job 裡依時間點；搜尋時依符合的程度。
public record DecisionTimelineDto(List<Item> items) {

    public record Item(JobSummary job, DecisionsDto.Item decision) {
    }

    // title 是 null 時顯示檔名；category 是 null 是還沒判斷。
    public record JobSummary(String jobId, String title, String fileName, String category, Instant createdAt) {
    }
}
