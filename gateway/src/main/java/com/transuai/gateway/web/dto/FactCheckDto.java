package com.transuai.gateway.web.dto;

import java.time.Instant;
import java.util.List;

// 事實查核（見 ai-service/CONTEXT.md「主張」「查核」）：一個 Job 標出主張的紀錄（沒標過是 null）與主張（依時間點排序）。
public record FactCheckDto(Extraction extraction, List<ClaimItem> claims) {

    // status：GENERATING / COMPLETED / FAILED（failureReason 是給使用者看的原因；之前標出的主張照樣在）。sourceRevision / model：
    // 上一次完成的依據 revision 與模型，還沒完成過是 0 / null。
    public record Extraction(String status, String failureReason, int sourceRevision, String modelProvider, String model,
            Instant requestedAt, Instant completedAt) {
    }

    // claim 是整理成一句完整、可以搜尋的陳述，text 是那個片段的原話；kind：number / fact；verdict：supported / disputed /
    // no_reliable_source / not_checkable，null 是還沒查；checking：查核中；checkError：上一次查核失敗的原因；sourceRevision：標出時的
    // 逐字稿 revision（比目前的小就是依據舊版的）。不知道的欄位是 null。
    public record ClaimItem(String id, String jobId, String speakerLabel, double startTime, String text, String claim,
            String kind, String verdict, String explanation, List<Source> sources, Instant checkedAt, String checkModel,
            boolean checking, String checkError, int sourceRevision) {
    }

    // 查核依據的網頁；順序就是說明裡 [n] 的編號。
    public record Source(String title, String url, String excerpt) {
    }
}
