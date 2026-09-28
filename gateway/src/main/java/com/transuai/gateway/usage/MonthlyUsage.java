package com.transuai.gateway.usage;

import java.util.List;
import java.util.UUID;

import org.springframework.stereotype.Component;

import lombok.RequiredArgsConstructor;
import transuai.ai.v1.Ai.LlmUsageSum;
import transuai.ai.v1.Ai.SumUserLlmUsageRequest;
import transuai.ai.v1.AiServiceGrpc;
import transuai.transcription.v1.Transcription.SumUserTranscriptionUsageRequest;
import transuai.transcription.v1.Transcription.TranscriptionUsageSum;
import transuai.transcription.v1.TranscriptionServiceGrpc;

/**
 * 一位使用者某個月的用量（見 ai-service/CONTEXT.md「用量」）：LLM 用量在 ai-service、轉錄用量在 transcription-service，各自存在自己
 * 的資料庫，這裡分別查詢。
 */
@Component
@RequiredArgsConstructor
public class MonthlyUsage {

    /** ai-service 記在 LLM 用量上的金鑰來源：平台付的（另一種是 {@code own_key}，使用者自己的金鑰）。 */
    static final String PLATFORM_KEY_SOURCE = "platform";

    private final AiServiceGrpc.AiServiceBlockingStub aiServiceStub;
    private final TranscriptionServiceGrpc.TranscriptionServiceBlockingStub transcriptionServiceStub;

    public List<LlmUsageSum> llm(UUID userId, UsageMonth month) {
        return aiServiceStub.sumUserLlmUsage(SumUserLlmUsageRequest.newBuilder()
                .setUserId(userId.toString()).setStart(month.start()).setEnd(month.end()).build()).getSumsList();
    }

    public List<TranscriptionUsageSum> transcription(UUID userId, UsageMonth month) {
        return transcriptionServiceStub.sumUserTranscriptionUsage(SumUserTranscriptionUsageRequest.newBuilder()
                .setUserId(userId.toString()).setStart(month.start()).setEnd(month.end()).build()).getSumsList();
    }

    /** 這個月轉錄了幾秒（已知的加總）。 */
    public double transcriptionSecondsThisMonth(UUID userId) {
        return transcription(userId, UsageMonth.current()).stream().mapToDouble(TranscriptionUsageSum::getAudioSeconds).sum();
    }

    /** 這個月平台模型用了幾個 token（輸入加輸出，已知的加總；自有金鑰的不算）。 */
    public long platformTokensThisMonth(UUID userId) {
        return llm(userId, UsageMonth.current()).stream()
                .filter(sum -> PLATFORM_KEY_SOURCE.equals(sum.getKeySource()))
                .mapToLong(sum -> sum.getInputTokens() + sum.getOutputTokens())
                .sum();
    }
}
