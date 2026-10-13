package com.transuai.gateway.web;

import java.util.HashSet;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
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
import com.transuai.gateway.web.dto.FactCheckDto;
import com.transuai.gateway.web.dto.CheckClaimsRequestDto;

import lombok.RequiredArgsConstructor;
import transuai.ai.v1.Ai.Claim;
import transuai.ai.v1.Ai.FactCheck;
import transuai.ai.v1.Ai.GetFactCheckRequest;
import transuai.ai.v1.Ai.JobFactCheck;
import transuai.ai.v1.Ai.RequestFactCheckRequest;
import transuai.ai.v1.Ai.CheckClaimsRequest;
import transuai.ai.v1.AiServiceGrpc;

// 事實查核（見 ai-service/CONTEXT.md「主張」「查核」）：標出主張在 ai-service 背景跑（不花搜尋次數），前端輪詢直到不是 GENERATING；
// 查核勾選的主張也在背景跑（每條查一次網路），前端輪詢直到沒有主張在查核中。
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
        return toDto(aiServiceStub.getFactCheck(GetFactCheckRequest.newBuilder().setJobId(jobId).build()));
    }

    // 查核勾選的主張：剩下的搜尋次數不夠查完全部就整批不查（429，說還剩幾次）；回傳這個 Job 的主張（勾選的標成查核中）。
    @CostlyFeature("claim-check")
    @PostMapping("/jobs/{jobId}/fact-check/verify")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public FactCheckDto check(@CurrentUserId UUID userId, @PathVariable String jobId,
            @RequestBody CheckClaimsRequestDto request) {
        jobOwnershipGuard.check(userId, jobId);
        if (request == null || request.claimIds() == null || request.claimIds().isEmpty()) {
            throw new IllegalArgumentException("claimIds are required"); // → 400 via GrpcExceptionAdvice
        }
        usageLimitGuard.requirePlatformTokensLeft(userId);
        Set<String> beingChecked = aiServiceStub.getFactCheck(GetFactCheckRequest.newBuilder().setJobId(jobId).build())
                .getClaimsList().stream().filter(Claim::getChecking).map(Claim::getId).collect(Collectors.toSet());
        Set<String> toSearch = new HashSet<>(request.claimIds());  // ai-service doesn't queue what's already being checked
        toSearch.removeAll(beingChecked);
        usageLimitGuard.requireWebSearchesLeftToCheck(userId, toSearch.size(), beingChecked.size());
        return toDto(aiServiceStub.checkClaims(CheckClaimsRequest.newBuilder()
                .setJobId(jobId).setUserId(userId.toString()).addAllClaimIds(request.claimIds()).build()));
    }

    private static FactCheckDto toDto(JobFactCheck found) {
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
