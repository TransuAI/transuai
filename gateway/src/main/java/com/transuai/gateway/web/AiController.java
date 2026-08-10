package com.transuai.gateway.web;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

import com.transuai.gateway.web.dto.SummaryDto;

import lombok.RequiredArgsConstructor;
import transuai.ai.v1.Ai.GetSummaryRequest;
import transuai.ai.v1.Ai.Summary;
import transuai.ai.v1.AiServiceGrpc;

// 對應 ../../architecture-design.md 3.4。AI Service MVP 階段只做了 GetSummary，
// chapters/qa/export 那三支 architecture-design.md 列的端點還沒有對應的 rpc 可轉發，
// 這裡先不開（見 ../../ai-service/README.md 已知限制、gateway 自己的 README 已知限制）。
// 跟 TranscriptionController 一樣，AiService 不驗證 x-user-id，只擋「沒登入」。
@RestController
@RequiredArgsConstructor
public class AiController {

    private final AiServiceGrpc.AiServiceBlockingStub aiServiceStub;

    @GetMapping("/summary/{jobId}")
    public SummaryDto getSummary(@PathVariable String jobId) {
        Summary summary = aiServiceStub.getSummary(GetSummaryRequest.newBuilder().setJobId(jobId).build());
        return new SummaryDto(summary.getJobId(), summary.getSummaryText());
    }
}
