package com.transuai.gateway.web;

import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import com.transuai.gateway.grpc.GrpcStrings;
import com.transuai.gateway.grpc.GrpcTimestamps;
import com.transuai.gateway.grpc.JobOwnershipGuard;
import com.transuai.gateway.ratelimit.CostlyFeature;
import com.transuai.gateway.usage.UsageLimitGuard;
import com.transuai.gateway.web.dto.DecisionsDto;

import lombok.RequiredArgsConstructor;
import transuai.ai.v1.Ai.Decision;
import transuai.ai.v1.Ai.DecisionExtraction;
import transuai.ai.v1.Ai.GetJobDecisionsRequest;
import transuai.ai.v1.Ai.JobDecisions;
import transuai.ai.v1.Ai.RequestDecisionExtractionRequest;
import transuai.ai.v1.AiServiceGrpc;

// 決策紀錄（見 ai-service/CONTEXT.md「決策」）：一個 Job 的決策在 ai-service 背景抽（會議、訪談轉錄完也會自動抽），前端輪詢直到不是
// GENERATING。
@RestController
@RequiredArgsConstructor
public class DecisionController {

    private final AiServiceGrpc.AiServiceBlockingStub aiServiceStub;
    private final JobOwnershipGuard jobOwnershipGuard;
    private final UsageLimitGuard usageLimitGuard;

    // 抽出（或重新抽出）這場的決策：已經在抽就直接回傳它；重新抽只換掉 AI 抽的、使用者沒改過的。
    @CostlyFeature("decision-extraction")
    @PostMapping("/jobs/{jobId}/decisions/extract")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public DecisionsDto.Extraction extract(@CurrentUserId UUID userId, @PathVariable String jobId) {
        jobOwnershipGuard.check(userId, jobId);
        usageLimitGuard.requirePlatformTokensLeft(userId);
        return toDto(aiServiceStub.requestDecisionExtraction(RequestDecisionExtractionRequest.newBuilder()
                .setJobId(jobId).setUserId(userId.toString()).build()));
    }

    @GetMapping("/jobs/{jobId}/decisions")
    public DecisionsDto list(@CurrentUserId UUID userId, @PathVariable String jobId) {
        jobOwnershipGuard.check(userId, jobId);
        JobDecisions found = aiServiceStub.getJobDecisions(GetJobDecisionsRequest.newBuilder().setJobId(jobId).build());
        return new DecisionsDto(found.hasExtraction() ? toDto(found.getExtraction()) : null,
                found.getDecisionsList().stream().map(DecisionController::toDto).toList());
    }

    private static DecisionsDto.Extraction toDto(DecisionExtraction extraction) {
        String status = switch (extraction.getStatus()) {
            case DECISION_EXTRACTION_STATUS_GENERATING -> "GENERATING";
            case DECISION_EXTRACTION_STATUS_COMPLETED -> "COMPLETED";
            default -> "FAILED";
        };
        return new DecisionsDto.Extraction(status, GrpcStrings.emptyToNull(extraction.getFailureReason()),
                extraction.getSourceRevision(), GrpcStrings.emptyToNull(extraction.getModelProvider()),
                GrpcStrings.emptyToNull(extraction.getModel()),
                extraction.hasRequestedAt() ? GrpcTimestamps.toInstant(extraction.getRequestedAt()) : null,
                extraction.hasCompletedAt() ? GrpcTimestamps.toInstant(extraction.getCompletedAt()) : null);
    }

    private static DecisionsDto.Item toDto(Decision decision) {
        return new DecisionsDto.Item(decision.getId(), decision.getJobId(), decision.getStatement(),
                decision.getRationale(), decision.getAlternativesList(), GrpcStrings.emptyToNull(decision.getProposedBy()),
                decision.getTentative(), decision.hasStartTime() ? decision.getStartTime() : null,
                GrpcStrings.emptyToNull(decision.getEvidenceText()), decision.getSource(), decision.getEdited(),
                GrpcStrings.emptyToNull(decision.getSupersedesId()),
                decision.hasCreatedAt() ? GrpcTimestamps.toInstant(decision.getCreatedAt()) : null);
    }
}
