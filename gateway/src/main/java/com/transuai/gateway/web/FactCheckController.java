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
import com.transuai.gateway.web.dto.FactCheckDto;

import lombok.RequiredArgsConstructor;
import transuai.ai.v1.Ai.Claim;
import transuai.ai.v1.Ai.FactCheck;
import transuai.ai.v1.Ai.GetFactCheckRequest;
import transuai.ai.v1.Ai.JobFactCheck;
import transuai.ai.v1.Ai.RequestFactCheckRequest;
import transuai.ai.v1.AiServiceGrpc;

// 事實查核（見 ai-service/CONTEXT.md「主張」「查核」）：標出主張在 ai-service 背景跑（不花搜尋次數），前端輪詢直到不是 GENERATING。
@RestController
@RequiredArgsConstructor
public class FactCheckController {

    private final AiServiceGrpc.AiServiceBlockingStub aiServiceStub;
    private final JobOwnershipGuard jobOwnershipGuard;
    private final UsageLimitGuard usageLimitGuard;

    // 標出（或重新標出）這個 Job 可以查核的主張：已經在標就直接回傳它；重新標出時查核過的主張保留。
    @CostlyFeature("fact-check")
    @PostMapping("/jobs/{jobId}/fact-check")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public FactCheckDto.Extraction find(@CurrentUserId UUID userId, @PathVariable String jobId) {
        jobOwnershipGuard.check(userId, jobId);
        usageLimitGuard.requirePlatformTokensLeft(userId);
        return toDto(aiServiceStub.requestFactCheck(RequestFactCheckRequest.newBuilder()
                .setJobId(jobId).setUserId(userId.toString()).build()));
    }

    @GetMapping("/jobs/{jobId}/fact-check")
    public FactCheckDto get(@CurrentUserId UUID userId, @PathVariable String jobId) {
        jobOwnershipGuard.check(userId, jobId);
        JobFactCheck found = aiServiceStub.getFactCheck(GetFactCheckRequest.newBuilder().setJobId(jobId).build());
        return new FactCheckDto(found.hasExtraction() ? toDto(found.getExtraction()) : null,
                found.getClaimsList().stream().map(FactCheckController::toDto).toList());
    }

    private static FactCheckDto.Extraction toDto(FactCheck factCheck) {
        String status = switch (factCheck.getStatus()) {
            case FACT_CHECK_STATUS_GENERATING -> "GENERATING";
            case FACT_CHECK_STATUS_COMPLETED -> "COMPLETED";
            default -> "FAILED";
        };
        return new FactCheckDto.Extraction(status, GrpcStrings.emptyToNull(factCheck.getFailureReason()),
                factCheck.getSourceRevision(), GrpcStrings.emptyToNull(factCheck.getModelProvider()),
                GrpcStrings.emptyToNull(factCheck.getModel()),
                factCheck.hasRequestedAt() ? GrpcTimestamps.toInstant(factCheck.getRequestedAt()) : null,
                factCheck.hasCompletedAt() ? GrpcTimestamps.toInstant(factCheck.getCompletedAt()) : null);
    }

    static FactCheckDto.ClaimItem toDto(Claim claim) {
        return new FactCheckDto.ClaimItem(claim.getId(), claim.getJobId(), GrpcStrings.emptyToNull(claim.getSpeakerLabel()),
                claim.getStartTime(), claim.getText(), claim.getClaim(), claim.getKind(),
                GrpcStrings.emptyToNull(claim.getVerdict()), GrpcStrings.emptyToNull(claim.getExplanation()),
                claim.getSourcesList().stream()
                        .map(s -> new FactCheckDto.Source(s.getTitle(), s.getUrl(), GrpcStrings.emptyToNull(s.getExcerpt())))
                        .toList(),
                claim.hasCheckedAt() ? GrpcTimestamps.toInstant(claim.getCheckedAt()) : null,
                GrpcStrings.emptyToNull(claim.getCheckModel()), claim.getChecking(),
                GrpcStrings.emptyToNull(claim.getCheckError()), claim.getSourceRevision());
    }
}
