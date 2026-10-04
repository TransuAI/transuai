package com.transuai.gateway.web.dto;

import java.time.Instant;
import java.util.List;

// 決策紀錄（見 ai-service/CONTEXT.md「決策」）：一個 Job 的抽取紀錄（沒抽過是 null）與決策（依時間點排序，沒有時間點的在後）。
public record DecisionsDto(Extraction extraction, List<Item> decisions) {

    // status：GENERATING / COMPLETED / FAILED（failureReason 是給使用者看的原因；之前抽好的決策照樣在）。sourceRevision / model：
    // 上一次完成的依據 revision 與模型，還沒完成過是 0 / null——跟逐字稿目前的 revision 不同就是過時。
    public record Extraction(String status, String failureReason, int sourceRevision, String modelProvider, String model,
            Instant requestedAt, Instant completedAt) {
    }

    // proposedBy 是講者標籤；startTime / evidenceText 是做成決定的時間點與那個片段的原話（使用者新增的可以沒有）；source：ai / user；
    // edited：使用者改過；supersedesId：取代了較早的哪一個決策。不知道的欄位是 null。
    public record Item(String id, String jobId, String statement, String rationale, List<String> alternatives,
            String proposedBy, boolean tentative, Double startTime, String evidenceText, String source, boolean edited,
            String supersedesId, Instant createdAt) {
    }
}
