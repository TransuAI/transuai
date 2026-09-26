package com.transuai.gateway.web;

import java.util.Comparator;
import java.util.List;
import java.util.Objects;
import java.util.UUID;
import java.util.stream.Stream;

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
import transuai.transcription.v1.Transcription.ListJobTranscriptionUsageRequest;
import transuai.transcription.v1.Transcription.TranscriptionUsage;
import transuai.transcription.v1.TranscriptionServiceGrpc;

// 用量（見 ai-service/CONTEXT.md「用量」）：LLM 用量在 ai-service、轉錄用量在 transcription-service，
// 各自存在自己的資料庫，這裡分別查詢再合併（見 CONTEXT-MAP.md）。
@RestController
@RequiredArgsConstructor
public class UsageController {

    private final AiServiceGrpc.AiServiceBlockingStub aiServiceStub;
    private final TranscriptionServiceGrpc.TranscriptionServiceBlockingStub transcriptionServiceStub;
    private final JobOwnershipGuard jobOwnershipGuard;

    @GetMapping("/jobs/{jobId}/usage")
    public JobUsageDto getJobUsage(@CurrentUserId UUID userId, @PathVariable String jobId) {
        jobOwnershipGuard.check(userId, jobId);
        Stream<UsageRecordDto> transcription = transcriptionServiceStub
                .listJobTranscriptionUsage(ListJobTranscriptionUsageRequest.newBuilder().setJobId(jobId).build())
                .getRecordsList().stream()
                .map(UsageController::toDto);
        Stream<UsageRecordDto> llm = aiServiceStub
                .listJobLlmUsage(ListJobLlmUsageRequest.newBuilder().setJobId(jobId).build())
                .getRecordsList().stream()
                .map(UsageController::toDto);
        List<UsageRecordDto> records = Stream.concat(transcription, llm)
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

    private static UsageRecordDto toDto(TranscriptionUsage usage) {
        return new UsageRecordDto("transcription", "transcription", usage.getProvider(), usage.getModel(),
                "platform", null, null, usage.hasAudioSeconds() ? usage.getAudioSeconds() : null,
                usage.getSucceeded(), GrpcTimestamps.toInstant(usage.getCreatedAt()));
    }

    private static UsageTotalsDto totals(List<UsageRecordDto> records) {
        return new UsageTotalsDto(
                records.stream().map(UsageRecordDto::inputTokens).filter(Objects::nonNull).mapToLong(Integer::longValue).sum(),
                records.stream().map(UsageRecordDto::outputTokens).filter(Objects::nonNull).mapToLong(Integer::longValue).sum(),
                records.stream().map(UsageRecordDto::audioSeconds).filter(Objects::nonNull).mapToDouble(Double::doubleValue).sum());
    }
}
