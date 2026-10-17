package com.transuai.gateway.web.dto;

import java.time.Instant;
import java.util.List;

// 講者數據的 AI 判斷（見 .scratch/speaker-analytics）：一個 Job 一份。status：NONE（還沒分析過）/ GENERATING / COMPLETED / FAILED
//（failureReason 是給使用者看的原因）。sourceRevision / model：上一次完成的依據 revision 與模型，還沒完成過是 0 / null——跟逐字稿目前的
// revision 不同就是過時。items 是上一次完成的結果（再分析時照樣在），依時間排序。
public record SpeakerInsightsDto(String status, String failureReason, int sourceRevision, String modelProvider,
        String model, Instant requestedAt, Instant completedAt, List<Item> items) {

    // kind：question / interruption；interruptedLabel 只有打斷才有；text 是那個片段的原話。
    public record Item(String kind, String speakerLabel, String interruptedLabel, double startTime, String text) {
    }
}
