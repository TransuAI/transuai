package com.transuai.gateway.web;

import java.util.List;
import java.util.UUID;

import org.springframework.http.HttpStatus;
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
import com.transuai.gateway.web.dto.GeneratedOutputDto;
import com.transuai.gateway.web.dto.OutputRequestDto;

import lombok.RequiredArgsConstructor;
import transuai.ai.v1.Ai.GeneratedOutput;
import transuai.ai.v1.Ai.GetOutputRequest;
import transuai.ai.v1.Ai.ListOutputsRequest;
import transuai.ai.v1.Ai.RequestOutputRequest;
import transuai.ai.v1.AiServiceGrpc;

// 多格式輸出（見 ai-service/CONTEXT.md「多格式輸出」）：在 ai-service 背景產生，前端輪詢列表直到不是 GENERATING。路徑刻意不用 /export
//（「匯出」是把既有內容轉成檔案，見 frontend/CONTEXT.md）。
@RestController
@RequiredArgsConstructor
public class OutputController {

    private final AiServiceGrpc.AiServiceBlockingStub aiServiceStub;
    private final JobOwnershipGuard jobOwnershipGuard;
    private final UsageLimitGuard usageLimitGuard;

    // 每次都多一份新的（舊的保留）；回傳「產生中」的那一份。格式不認得、要求太長回 400。Job 的標題一起帶給 ai-service（它沒有 Job 的資料）。
    @CostlyFeature("output")
    @PostMapping("/jobs/{jobId}/outputs")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public GeneratedOutputDto request(@CurrentUserId UUID userId, @PathVariable String jobId,
            @RequestBody OutputRequestDto request) {
        String title = jobOwnershipGuard.fetch(userId, jobId).getTitle();
        if (request == null || request.format() == null) {
            throw new IllegalArgumentException("format is required"); // → 400 via GrpcExceptionAdvice
        }
        usageLimitGuard.requirePlatformTokensLeft(userId);
        return toDto(aiServiceStub.requestOutput(RequestOutputRequest.newBuilder()
                .setJobId(jobId)
                .setUserId(userId.toString())
                .setFormat(request.format())
                .setTitle(title)
                .setInstruction(request.instruction() == null ? "" : request.instruction())
                .setPlatform(request.platform() == null ? "" : request.platform())
                .build()));
    }

    // 新的在前，含內容。
    @GetMapping("/jobs/{jobId}/outputs")
    public List<GeneratedOutputDto> list(@CurrentUserId UUID userId, @PathVariable String jobId) {
        jobOwnershipGuard.check(userId, jobId);
        return aiServiceStub.listOutputs(ListOutputsRequest.newBuilder().setJobId(jobId).build())
                .getOutputsList().stream().map(OutputController::toDto).toList();
    }

    @GetMapping("/jobs/{jobId}/outputs/{outputId}")
    public GeneratedOutputDto get(@CurrentUserId UUID userId, @PathVariable String jobId, @PathVariable String outputId) {
        jobOwnershipGuard.check(userId, jobId);
        return toDto(aiServiceStub.getOutput(GetOutputRequest.newBuilder().setJobId(jobId).setOutputId(outputId).build()));
    }

    private static GeneratedOutputDto toDto(GeneratedOutput output) {
        return new GeneratedOutputDto(output.getId(), output.getJobId(), output.getFormat(),
                GrpcStrings.emptyToNull(output.getPlatform()), GrpcStrings.emptyToNull(output.getInstruction()), output.getStatus().name().replace("OUTPUT_STATUS_", ""),
                GrpcStrings.emptyToNull(output.getFailureReason()), GrpcStrings.emptyToNull(output.getContent()),
                output.getSourceRevision(), GrpcStrings.emptyToNull(output.getModelProvider()),
                GrpcStrings.emptyToNull(output.getModel()), GrpcTimestamps.toInstant(output.getRequestedAt()),
                output.hasCompletedAt() ? GrpcTimestamps.toInstant(output.getCompletedAt()) : null,
                output.hasEditedAt() ? GrpcTimestamps.toInstant(output.getEditedAt()) : null);
    }
}
