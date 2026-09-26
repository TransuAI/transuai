package com.transuai.gateway.web;

import java.time.Clock;
import java.time.Instant;
import java.time.YearMonth;
import java.time.ZoneId;
import java.time.format.DateTimeParseException;
import java.util.Comparator;
import java.util.List;
import java.util.Objects;
import java.util.UUID;
import java.util.stream.Stream;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.transuai.gateway.grpc.GrpcTimestamps;
import com.transuai.gateway.grpc.JobOwnershipGuard;
import com.transuai.gateway.web.dto.JobUsageDto;
import com.transuai.gateway.web.dto.LlmUsageSumDto;
import com.transuai.gateway.web.dto.MonthlyUsageDto;
import com.transuai.gateway.web.dto.TranscriptionUsageSumDto;
import com.transuai.gateway.web.dto.UsageRecordDto;
import com.transuai.gateway.web.dto.UsageTotalsDto;

import lombok.RequiredArgsConstructor;
import transuai.ai.v1.Ai.ListJobLlmUsageRequest;
import transuai.ai.v1.Ai.LlmUsage;
import transuai.ai.v1.Ai.LlmUsageSum;
import transuai.ai.v1.Ai.SumUserLlmUsageRequest;
import transuai.ai.v1.AiServiceGrpc;
import transuai.transcription.v1.Transcription.ListJobTranscriptionUsageRequest;
import transuai.transcription.v1.Transcription.SumUserTranscriptionUsageRequest;
import transuai.transcription.v1.Transcription.TranscriptionUsage;
import transuai.transcription.v1.Transcription.TranscriptionUsageSum;
import transuai.transcription.v1.TranscriptionServiceGrpc;

// 用量（見 ai-service/CONTEXT.md「用量」）：LLM 用量在 ai-service、轉錄用量在 transcription-service，
// 各自存在自己的資料庫，這裡分別查詢再合併（見 CONTEXT-MAP.md）。
@RestController
@RequiredArgsConstructor
public class UsageController {

    // 「某個月」依台灣時間切：使用者看到的月份跟他的月曆一致。
    private static final ZoneId USAGE_ZONE = ZoneId.of("Asia/Taipei");

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

    // month 省略就是這個月。
    @GetMapping("/me/usage")
    public MonthlyUsageDto getMonthlyUsage(@CurrentUserId UUID userId,
            @RequestParam(required = false) String month) {
        YearMonth yearMonth = month == null ? YearMonth.now(Clock.system(USAGE_ZONE)) : parseMonth(month);
        Instant start = yearMonth.atDay(1).atStartOfDay(USAGE_ZONE).toInstant();
        Instant end = yearMonth.plusMonths(1).atDay(1).atStartOfDay(USAGE_ZONE).toInstant();

        List<LlmUsageSumDto> llm = aiServiceStub
                .sumUserLlmUsage(SumUserLlmUsageRequest.newBuilder()
                        .setUserId(userId.toString())
                        .setStart(GrpcTimestamps.fromInstant(start))
                        .setEnd(GrpcTimestamps.fromInstant(end))
                        .build())
                .getSumsList().stream()
                .map(UsageController::toDto)
                .toList();
        List<TranscriptionUsageSumDto> transcription = transcriptionServiceStub
                .sumUserTranscriptionUsage(SumUserTranscriptionUsageRequest.newBuilder()
                        .setUserId(userId.toString())
                        .setStart(GrpcTimestamps.fromInstant(start))
                        .setEnd(GrpcTimestamps.fromInstant(end))
                        .build())
                .getSumsList().stream()
                .map(UsageController::toDto)
                .toList();
        return new MonthlyUsageDto(yearMonth.toString(), llm, transcription);
    }

    private static YearMonth parseMonth(String month) {
        try {
            return YearMonth.parse(month);
        } catch (DateTimeParseException e) {
            throw new IllegalArgumentException("month must be YYYY-MM"); // → 400 via GrpcExceptionAdvice
        }
    }

    private static LlmUsageSumDto toDto(LlmUsageSum sum) {
        return new LlmUsageSumDto(sum.getProvider(), sum.getModel(), sum.getKeySource(), sum.getInputTokens(),
                sum.getOutputTokens(), sum.getCalls(), sum.getCallsWithUnknownUsage());
    }

    private static TranscriptionUsageSumDto toDto(TranscriptionUsageSum sum) {
        return new TranscriptionUsageSumDto(sum.getProvider(), sum.getModel(), sum.getAudioSeconds(), sum.getCalls(),
                sum.getCallsWithUnknownUsage());
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
