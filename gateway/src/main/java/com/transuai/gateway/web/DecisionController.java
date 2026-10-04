package com.transuai.gateway.web;

import java.util.List;
import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import com.transuai.gateway.grpc.GrpcStrings;
import com.transuai.gateway.grpc.GrpcTimestamps;
import com.transuai.gateway.grpc.JobOwnershipGuard;
import com.transuai.gateway.ratelimit.CostlyFeature;
import com.transuai.gateway.usage.UsageLimitGuard;
import com.transuai.gateway.web.dto.DecisionInputDto;
import com.transuai.gateway.web.dto.DecisionsDto;

import lombok.RequiredArgsConstructor;
import transuai.ai.v1.Ai.CreateDecisionRequest;
import transuai.ai.v1.Ai.Decision;
import transuai.ai.v1.Ai.DecisionExtraction;
import transuai.ai.v1.Ai.DecisionInput;
import transuai.ai.v1.Ai.DeleteDecisionRequest;
import transuai.ai.v1.Ai.GetJobDecisionsRequest;
import transuai.ai.v1.Ai.JobDecisions;
import transuai.ai.v1.Ai.RequestDecisionExtractionRequest;
import transuai.ai.v1.Ai.UpdateDecisionRequest;
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

    // 使用者自己新增一個決策（時間點可以沒有）；內容不合規則回 400 與原因。
    @PostMapping("/jobs/{jobId}/decisions")
    @ResponseStatus(HttpStatus.CREATED)
    public DecisionsDto.Item create(@CurrentUserId UUID userId, @PathVariable String jobId,
            @RequestBody DecisionInputDto body) {
        jobOwnershipGuard.check(userId, jobId);
        CreateDecisionRequest.Builder request = CreateDecisionRequest.newBuilder().setJobId(jobId)
                .setUserId(userId.toString()).setDecision(toInput(body));
        if (body != null && body.startTime() != null) {
            request.setStartTime(body.startTime());
        }
        return toDto(aiServiceStub.createDecision(request.build()));
    }

    // 修改內容（時間點與原話不變），之後重新抽也保留；不是這個 Job 的回 404。
    @PatchMapping("/jobs/{jobId}/decisions/{decisionId}")
    public DecisionsDto.Item update(@CurrentUserId UUID userId, @PathVariable String jobId,
            @PathVariable String decisionId, @RequestBody DecisionInputDto body) {
        jobOwnershipGuard.check(userId, jobId);
        return toDto(aiServiceStub.updateDecision(UpdateDecisionRequest.newBuilder().setJobId(jobId)
                .setDecisionId(decisionId).setDecision(toInput(body)).build()));
    }

    // AI 抽的只是隱藏（重新抽時不再出現），使用者新增的直接刪掉；不是這個 Job 的回 404。
    @DeleteMapping("/jobs/{jobId}/decisions/{decisionId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@CurrentUserId UUID userId, @PathVariable String jobId, @PathVariable String decisionId) {
        jobOwnershipGuard.check(userId, jobId);
        aiServiceStub.deleteDecision(DeleteDecisionRequest.newBuilder().setJobId(jobId).setDecisionId(decisionId).build());
    }

    private static DecisionInput toInput(DecisionInputDto body) {
        if (body == null) {
            return DecisionInput.getDefaultInstance(); // → 400 from ai-service: 決定不能是空的
        }
        return DecisionInput.newBuilder()
                .setStatement(body.statement() == null ? "" : body.statement())
                .setRationale(body.rationale() == null ? "" : body.rationale())
                .addAllAlternatives(body.alternatives() == null ? List.of() : body.alternatives())
                .setProposedBy(body.proposedBy() == null ? "" : body.proposedBy())
                .setTentative(Boolean.TRUE.equals(body.tentative()))
                .build();
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
