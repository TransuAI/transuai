package com.transuai.gateway.web;

import java.util.List;
import java.util.UUID;

import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import com.transuai.gateway.grpc.GrpcTimestamps;
import com.transuai.gateway.web.dto.DeleteProviderKeyResponseDto;
import com.transuai.gateway.web.dto.ProviderKeyDto;
import com.transuai.gateway.web.dto.SaveProviderKeyRequestDto;

import lombok.RequiredArgsConstructor;
import transuai.ai.v1.Ai.DeleteProviderKeyRequest;
import transuai.ai.v1.Ai.ListProviderKeysRequest;
import transuai.ai.v1.Ai.ProviderKey;
import transuai.ai.v1.Ai.SaveProviderKeyRequest;
import transuai.ai.v1.AiServiceGrpc;

// 自有金鑰（見 ai-service/CONTEXT.md）：一律是登入者自己的，使用者從 JWT 取得。驗證、加密都在 ai-service 做。
@RestController
@RequiredArgsConstructor
public class ProviderKeyController {

    private final AiServiceGrpc.AiServiceBlockingStub aiServiceStub;

    @GetMapping("/me/provider-keys")
    public List<ProviderKeyDto> listProviderKeys(@CurrentUserId UUID userId) {
        return aiServiceStub.listProviderKeys(ListProviderKeysRequest.newBuilder().setUserId(userId.toString()).build())
                .getKeysList().stream()
                .map(ProviderKeyController::toDto)
                .toList();
    }

    // 存入或替換；ai-service 先向廠商驗證，金鑰無效回 400（附原因）、廠商暫時連不上回 503。
    @PutMapping("/me/provider-keys/{provider}")
    public ProviderKeyDto saveProviderKey(@CurrentUserId UUID userId, @PathVariable String provider,
            @RequestBody SaveProviderKeyRequestDto request) {
        if (request == null || request.key() == null) {
            throw new IllegalArgumentException("key is required"); // → 400 via GrpcExceptionAdvice
        }
        return toDto(aiServiceStub.saveProviderKey(SaveProviderKeyRequest.newBuilder()
                .setUserId(userId.toString())
                .setProvider(provider)
                .setKey(request.key())
                .build()));
    }

    @DeleteMapping("/me/provider-keys/{provider}")
    public DeleteProviderKeyResponseDto deleteProviderKey(@CurrentUserId UUID userId, @PathVariable String provider) {
        return new DeleteProviderKeyResponseDto(aiServiceStub.deleteProviderKey(DeleteProviderKeyRequest.newBuilder()
                .setUserId(userId.toString())
                .setProvider(provider)
                .build()).getDeleted());
    }

    private static ProviderKeyDto toDto(ProviderKey key) {
        return new ProviderKeyDto(key.getProvider(), key.getLast4(), GrpcTimestamps.toInstant(key.getCreatedAt()));
    }
}
