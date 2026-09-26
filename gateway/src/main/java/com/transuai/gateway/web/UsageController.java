package com.transuai.gateway.web;

import java.util.Comparator;
import java.util.List;
import java.util.Objects;
import java.util.UUID;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

import com.transuai.gateway.grpc.GrpcTimestamps;
import com.transuai.gateway.grpc.JobOwnershipGuard;
import com.transuai.gateway.web.dto.JobUsageDto;
import com.transuai.gateway.web.dto.UsageRecordDto;
import com.transuai.gateway.web.dto.UsageTotalsDto;

import lombok.RequiredArgsConstructor;
import transuai.ai.v1.Ai.ListJobLlmUsageRequest;
import transuai.ai.v1.Ai.LlmUsage;
import transuai.ai.v1.AiServiceGrpc;

// 用量（見 ai-service/CONTEXT.md「用量」）：各服務存在自己的資料庫，由這裡查詢後合併（見 CONTEXT-MAP.md）。
// 目前只有 ai-service 的 LLM 用量；轉錄用量還沒記錄。
@RestController
@RequiredArgsConstructor
public class UsageController {

    private final AiServiceGrpc.AiServiceBlockingStub aiServiceStub;
    private final JobOwnershipGuard jobOwnershipGuard;

    @GetMapping("/jobs/{jobId}/usage")
    public JobUsageDto getJobUsage(@CurrentUserId UUID userId, @PathVariable String jobId) {
        jobOwnershipGuard.check(userId, jobId);
        List<UsageRecordDto> records = aiServiceStub
                .listJobLlmUsage(ListJobLlmUsageRequest.newBuilder().setJobId(jobId).build())
                .getRecordsList().stream()
                .map(UsageController::toDto)
                .sorted(Comparator.comparing(UsageRecordDto::createdAt))
                .toList();
        return new JobUsageDto(records, totals(records));
    }

    private static UsageRecordDto toDto(LlmUsage usage) {
        return new UsageRecordDto("llm", usage.getFeature(), usage.getProvider(), usage.getModel(),
                usage.getKeySource(),
                usage.hasInputTokens() ? usage.getInputTokens() : null,
                usage.hasOutputTokens() ? usage.getOutputTokens() : null,
                null, usage.getSucceeded(), GrpcTimestamps.toInstant(usage.getCreatedAt()));
    }

    private static UsageTotalsDto totals(List<UsageRecordDto> records) {
        return new UsageTotalsDto(
                records.stream().map(UsageRecordDto::inputTokens).filter(Objects::nonNull).mapToLong(Integer::longValue).sum(),
                records.stream().map(UsageRecordDto::outputTokens).filter(Objects::nonNull).mapToLong(Integer::longValue).sum(),
                records.stream().map(UsageRecordDto::audioSeconds).filter(Objects::nonNull).mapToDouble(Double::doubleValue).sum());
    }
}
