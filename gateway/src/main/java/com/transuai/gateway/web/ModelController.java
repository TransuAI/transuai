package com.transuai.gateway.web;

import java.util.UUID;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import com.transuai.gateway.ratelimit.CostlyFeature;
import com.transuai.gateway.web.dto.AvailableModelsDto;
import com.transuai.gateway.web.dto.ModelChoiceDto;
import com.transuai.gateway.web.dto.SetDefaultModelRequestDto;

import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import transuai.ai.v1.Ai.GetDefaultModelRequest;
import transuai.ai.v1.Ai.ListAvailableModelsRequest;
import transuai.ai.v1.Ai.ListAvailableModelsResponse;
import transuai.ai.v1.Ai.ModelChoice;
import transuai.ai.v1.Ai.SetDefaultModelRequest;
import transuai.ai.v1.AiServiceGrpc;

// 預設模型（見 ai-service/CONTEXT.md）：一律是登入者自己的，使用者從 JWT 取得。
@RestController
@RequiredArgsConstructor
public class ModelController {

    private final AiServiceGrpc.AiServiceBlockingStub aiServiceStub;

    @GetMapping("/ai/models")
    public AvailableModelsDto listAvailableModels(@CurrentUserId UUID userId) {
        ListAvailableModelsResponse response = aiServiceStub.listAvailableModels(
                ListAvailableModelsRequest.newBuilder().setUserId(userId.toString()).build());
        return new AvailableModelsDto(
                response.getModelsList().stream().map(ModelController::toDto).toList(), response.getOpenrouterCustom(),
                response.getWebSearch());
    }

    @GetMapping("/me/default-model")
    public ModelChoiceDto getDefaultModel(@CurrentUserId UUID userId) {
        return toDto(aiServiceStub.getDefaultModel(GetDefaultModelRequest.newBuilder().setUserId(userId.toString()).build()));
    }

    // 模型不在清單上（或 OpenRouter 上不存在）回 400、沒有那個廠商的自有金鑰回 409、OpenRouter 查不到回 503。
    @CostlyFeature("linked-service")
    @PutMapping("/me/default-model")
    public ModelChoiceDto setDefaultModel(@CurrentUserId UUID userId, @Valid @RequestBody SetDefaultModelRequestDto request) {
        if (request == null || request.provider() == null) {
            throw new IllegalArgumentException("provider is required"); // → 400 via GrpcExceptionAdvice
        }
        return toDto(aiServiceStub.setDefaultModel(SetDefaultModelRequest.newBuilder()
                .setUserId(userId.toString())
                .setProvider(request.provider())
                .setModel(request.model() == null ? "" : request.model())
                .build()));
    }

    private static ModelChoiceDto toDto(ModelChoice choice) {
        return new ModelChoiceDto(choice.getProvider(), choice.getModel(), choice.getSupportsTools());
    }
}
