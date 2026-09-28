package com.transuai.gateway.usage;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.YearMonth;
import java.time.ZoneId;
import java.util.List;
import java.util.UUID;

import org.springframework.stereotype.Component;

import com.transuai.gateway.grpc.GrpcTimestamps;

import lombok.RequiredArgsConstructor;
import transuai.ai.v1.Ai.LlmUsageSum;
import transuai.ai.v1.Ai.SumUserLlmUsageRequest;
import transuai.ai.v1.AiServiceGrpc;
import transuai.transcription.v1.Transcription.SumUserTranscriptionUsageRequest;
import transuai.transcription.v1.Transcription.TranscriptionUsageSum;
import transuai.transcription.v1.TranscriptionServiceGrpc;

/**
 * 一位使用者某個月的用量（見 ai-service/CONTEXT.md「用量」）：LLM 用量在 ai-service、轉錄用量在 transcription-service，各自存在自己
 * 的資料庫，這裡分別查詢。「某個月」依台灣時間切：使用者看到的月份跟他的月曆一致。
 */
@Component
@RequiredArgsConstructor
public class MonthlyUsage {

    static final ZoneId ZONE = ZoneId.of("Asia/Taipei");
    static final String PLATFORM = "platform";

    private final AiServiceGrpc.AiServiceBlockingStub aiServiceStub;
    private final TranscriptionServiceGrpc.TranscriptionServiceBlockingStub transcriptionServiceStub;

    public static YearMonth thisMonth() {
        return YearMonth.now(Clock.system(ZONE));
    }

    /** 到下個月 1 日（台灣時間）還有幾秒。 */
    public static long secondsUntilNextMonth() {
        return Math.max(1, Duration.between(Instant.now(), start(thisMonth().plusMonths(1))).toSeconds());
    }

    public List<LlmUsageSum> llm(UUID userId, YearMonth month) {
        return aiServiceStub.sumUserLlmUsage(SumUserLlmUsageRequest.newBuilder()
                .setUserId(userId.toString())
                .setStart(GrpcTimestamps.fromInstant(start(month)))
                .setEnd(GrpcTimestamps.fromInstant(start(month.plusMonths(1))))
                .build()).getSumsList();
    }

    public List<TranscriptionUsageSum> transcription(UUID userId, YearMonth month) {
        return transcriptionServiceStub.sumUserTranscriptionUsage(SumUserTranscriptionUsageRequest.newBuilder()
                .setUserId(userId.toString())
                .setStart(GrpcTimestamps.fromInstant(start(month)))
                .setEnd(GrpcTimestamps.fromInstant(start(month.plusMonths(1))))
                .build()).getSumsList();
    }

    /** 這個月轉錄了幾秒（已知的加總）。 */
    public double transcriptionSecondsThisMonth(UUID userId) {
        return transcription(userId, thisMonth()).stream().mapToDouble(TranscriptionUsageSum::getAudioSeconds).sum();
    }

    /** 這個月平台模型用了幾個 token（輸入加輸出，已知的加總；自有金鑰的不算）。 */
    public long platformTokensThisMonth(UUID userId) {
        return llm(userId, thisMonth()).stream()
                .filter(sum -> PLATFORM.equals(sum.getKeySource()))
                .mapToLong(sum -> sum.getInputTokens() + sum.getOutputTokens())
                .sum();
    }

    private static Instant start(YearMonth month) {
        return month.atDay(1).atStartOfDay(ZONE).toInstant();
    }
}
