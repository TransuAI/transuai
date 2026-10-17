package com.transuai.gateway.web;

import java.util.List;
import java.util.UUID;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import com.transuai.gateway.grpc.GrpcStrings;
import com.transuai.gateway.grpc.JobOwnershipGuard;
import com.transuai.gateway.web.dto.SpeakerSuggestionDto;
import com.transuai.gateway.web.dto.SpeakerSuggestionStatusRequestDto;

import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import transuai.ai.v1.Ai.ListSpeakerSuggestionsRequest;
import transuai.ai.v1.Ai.SetSpeakerSuggestionStatusRequest;
import transuai.ai.v1.AiServiceGrpc;

// 講者名字建議（見 ai-service/CONTEXT.md）：ai-service 不驗證使用者，這裡先用 JobOwnershipGuard 確認 Job 是登入者的。
@RestController
@RequiredArgsConstructor
public class SpeakerSuggestionController {

    private final AiServiceGrpc.AiServiceBlockingStub aiServiceStub;
    private final JobOwnershipGuard jobOwnershipGuard;

    @GetMapping("/jobs/{jobId}/speaker-suggestions")
    public List<SpeakerSuggestionDto> listSuggestions(@CurrentUserId UUID userId, @PathVariable String jobId) {
        jobOwnershipGuard.check(userId, jobId);
        return aiServiceStub.listSpeakerSuggestions(ListSpeakerSuggestionsRequest.newBuilder().setJobId(jobId).build())
                .getSuggestionsList().stream().map(SpeakerSuggestionDto::from).toList();
    }

    // status 不是 applied / dismissed 回 400、這位講者沒有建議回 404（ai-service 的 INVALID_ARGUMENT / NOT_FOUND）。
    @PutMapping("/jobs/{jobId}/speaker-suggestions/{label}")
    public SpeakerSuggestionDto setStatus(@CurrentUserId UUID userId, @PathVariable String jobId,
            @PathVariable String label, @Valid @RequestBody SpeakerSuggestionStatusRequestDto request) {
        jobOwnershipGuard.check(userId, jobId);
        return SpeakerSuggestionDto.from(aiServiceStub.setSpeakerSuggestionStatus(SetSpeakerSuggestionStatusRequest
                .newBuilder().setJobId(jobId).setSpeakerLabel(label)
                .setStatus(GrpcStrings.nullToEmpty(request.status())).build()));
    }
}
