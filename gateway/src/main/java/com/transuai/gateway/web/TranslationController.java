package com.transuai.gateway.web;

import java.util.List;
import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
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
import com.transuai.gateway.web.dto.TranslationDto;
import com.transuai.gateway.web.dto.TranslationRequestDto;

import lombok.RequiredArgsConstructor;
import transuai.ai.v1.Ai.DeleteTranslationRequest;
import transuai.ai.v1.Ai.GetTranslationRequest;
import transuai.ai.v1.Ai.ListTranslationsRequest;
import transuai.ai.v1.Ai.RequestTranslationRequest;
import transuai.ai.v1.Ai.Translation;
import transuai.ai.v1.AiServiceGrpc;

// 譯文（見 ai-service/CONTEXT.md「譯文」）：在 ai-service 背景一批一批翻，前端輪詢列表看進度，翻好的片段隨時取得得到。
@RestController
@RequiredArgsConstructor
public class TranslationController {

    private final AiServiceGrpc.AiServiceBlockingStub aiServiceStub;
    private final JobOwnershipGuard jobOwnershipGuard;
    private final UsageLimitGuard usageLimitGuard;

    // 一種語言一份：已經在翻就直接回傳它；翻好的再要求一次是補翻缺的。不支援的語言回 400。
    @CostlyFeature("translation")
    @PostMapping("/jobs/{jobId}/translations")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public TranslationDto request(@CurrentUserId UUID userId, @PathVariable String jobId,
            @RequestBody TranslationRequestDto request) {
        jobOwnershipGuard.check(userId, jobId);
        if (request == null || request.language() == null) {
            throw new IllegalArgumentException("language is required"); // → 400 via GrpcExceptionAdvice
        }
        usageLimitGuard.requirePlatformTokensLeft(userId);
        return toDto(aiServiceStub.requestTranslation(RequestTranslationRequest.newBuilder()
                .setJobId(jobId).setUserId(userId.toString()).setLanguage(request.language()).build()), false);
    }

    @GetMapping("/jobs/{jobId}/translations")
    public List<TranslationDto> list(@CurrentUserId UUID userId, @PathVariable String jobId) {
        jobOwnershipGuard.check(userId, jobId);
        return aiServiceStub.listTranslations(ListTranslationsRequest.newBuilder().setJobId(jobId).build())
                .getTranslationsList().stream().map(translation -> toDto(translation, false)).toList();
    }

    // 含片段的譯文（翻譯中也取得得到已經翻好的）；沒有這種語言回 404。
    @GetMapping("/jobs/{jobId}/translations/{language}")
    public TranslationDto get(@CurrentUserId UUID userId, @PathVariable String jobId, @PathVariable String language) {
        jobOwnershipGuard.check(userId, jobId);
        return toDto(aiServiceStub.getTranslation(GetTranslationRequest.newBuilder()
                .setJobId(jobId).setLanguage(language).build()), true);
    }

    // 刪掉一種語言的譯文；沒有這種語言回 404。
    @DeleteMapping("/jobs/{jobId}/translations/{language}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@CurrentUserId UUID userId, @PathVariable String jobId, @PathVariable String language) {
        jobOwnershipGuard.check(userId, jobId);
        aiServiceStub.deleteTranslation(DeleteTranslationRequest.newBuilder().setJobId(jobId).setLanguage(language).build());
    }

    private static TranslationDto toDto(Translation translation, boolean withSegments) {
        return new TranslationDto(translation.getLanguage(),
                translation.getStatus().name().replace("TRANSLATION_STATUS_", ""),
                GrpcStrings.emptyToNull(translation.getFailureReason()), translation.getTotalSegments(),
                translation.getTranslatedSegments(), GrpcStrings.emptyToNull(translation.getModelProvider()),
                GrpcStrings.emptyToNull(translation.getModel()), GrpcTimestamps.toInstant(translation.getRequestedAt()),
                translation.hasCompletedAt() ? GrpcTimestamps.toInstant(translation.getCompletedAt()) : null,
                withSegments ? translation.getSegmentsList().stream()
                        .map(s -> new TranslationDto.Segment(s.getSegmentId(), s.getText())).toList() : null);
    }
}
