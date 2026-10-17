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
import com.transuai.gateway.web.dto.SpeakerInsightsDto;

import lombok.RequiredArgsConstructor;
import transuai.ai.v1.Ai.GetSpeakerInsightsRequest;
import transuai.ai.v1.Ai.RequestSpeakerInsightsRequest;
import transuai.ai.v1.Ai.SpeakerInsights;
import transuai.ai.v1.AiServiceGrpc;

// 講者數據的 AI 判斷（每位講者提出的問題、可能的打斷）：在 ai-service 背景分析，前端輪詢直到不是 GENERATING。直接算的講者數據在前端。
@RestController
@RequiredArgsConstructor
public class SpeakerInsightsController {

    private final AiServiceGrpc.AiServiceBlockingStub aiServiceStub;
    private final JobOwnershipGuard jobOwnershipGuard;
    private final UsageLimitGuard usageLimitGuard;

    // 一個 Job 一份，再分析就取代（完成才換掉）；已經在分析中就直接回傳它。
    @CostlyFeature("speaker-insights")
    @PostMapping("/jobs/{jobId}/speaker-insights")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public SpeakerInsightsDto request(@CurrentUserId UUID userId, @PathVariable String jobId) {
        jobOwnershipGuard.check(userId, jobId);
        usageLimitGuard.requirePlatformTokensLeft(userId);
        return toDto(aiServiceStub.requestSpeakerInsights(RequestSpeakerInsightsRequest.newBuilder()
                .setJobId(jobId).setUserId(userId.toString()).build()));
    }

    @GetMapping("/jobs/{jobId}/speaker-insights")
    public SpeakerInsightsDto get(@CurrentUserId UUID userId, @PathVariable String jobId) {
        jobOwnershipGuard.check(userId, jobId);
        return toDto(aiServiceStub.getSpeakerInsights(GetSpeakerInsightsRequest.newBuilder().setJobId(jobId).build()));
    }

    private static SpeakerInsightsDto toDto(SpeakerInsights insights) {
        String status = switch (insights.getStatus()) {
            case SPEAKER_INSIGHTS_STATUS_GENERATING -> "GENERATING";
            case SPEAKER_INSIGHTS_STATUS_COMPLETED -> "COMPLETED";
            case SPEAKER_INSIGHTS_STATUS_FAILED -> "FAILED";
            default -> "NONE";
        };
        return new SpeakerInsightsDto(status, GrpcStrings.emptyToNull(insights.getFailureReason()),
                insights.getSourceRevision(), GrpcStrings.emptyToNull(insights.getModelProvider()),
                GrpcStrings.emptyToNull(insights.getModel()),
                insights.hasRequestedAt() ? GrpcTimestamps.toInstant(insights.getRequestedAt()) : null,
                insights.hasCompletedAt() ? GrpcTimestamps.toInstant(insights.getCompletedAt()) : null,
                insights.getItemsList().stream()
                        .map(item -> new SpeakerInsightsDto.Item(item.getKind(), item.getSpeakerLabel(),
                                GrpcStrings.emptyToNull(item.getInterruptedLabel()), item.getStartTime(), item.getText()))
                        .toList());
    }
}
