package com.transuai.gateway.web;

import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.transuai.gateway.grpc.GrpcStrings;
import com.transuai.gateway.grpc.GrpcTimestamps;
import com.transuai.gateway.grpc.JobOwnershipGuard;
import com.transuai.gateway.web.dto.ActionProposalDto;
import com.transuai.gateway.web.dto.ExecuteProposalsRequestDto;
import com.transuai.gateway.web.dto.PostMeetingDto;
import com.transuai.gateway.web.dto.PostMeetingRequestDto;
import com.transuai.gateway.web.dto.PostMeetingRunDto;
import com.transuai.gateway.web.dto.PostMeetingSettingsDto;
import com.transuai.gateway.web.dto.UpdatePostMeetingSettingsDto;
import com.transuai.upload.grpc.v1.Job;

import lombok.RequiredArgsConstructor;
import transuai.ai.v1.Ai.ActionProposal;
import transuai.ai.v1.Ai.ExecuteProposalsRequest;
import transuai.ai.v1.Ai.GetPostMeetingRequest;
import transuai.ai.v1.Ai.GetPostMeetingSettingsRequest;
import transuai.ai.v1.Ai.NotionLocation;
import transuai.ai.v1.Ai.PostMeeting;
import transuai.ai.v1.Ai.PostMeetingRun;
import transuai.ai.v1.Ai.PostMeetingSettings;
import transuai.ai.v1.Ai.ProposalToExecute;
import transuai.ai.v1.Ai.RequestPostMeetingRequest;
import transuai.ai.v1.Ai.RetryProposalRequest;
import transuai.ai.v1.Ai.TodoDestination;
import transuai.ai.v1.Ai.UpdatePostMeetingSettingsRequest;
import transuai.ai.v1.AiServiceGrpc;

// 會後處理（見 ai-service/CONTEXT.md）：在 ai-service 背景跑 agent，前端每 3 秒輪詢 GET 直到不是 RUNNING。
@RestController
@RequiredArgsConstructor
public class PostMeetingController {

    private final AiServiceGrpc.AiServiceBlockingStub aiServiceStub;
    private final JobOwnershipGuard jobOwnershipGuard;
    private final ObjectMapper objectMapper;

    @GetMapping("/jobs/{jobId}/post-meeting")
    public PostMeetingDto getPostMeeting(@CurrentUserId UUID userId, @PathVariable String jobId) {
        jobOwnershipGuard.check(userId, jobId);
        return toDto(aiServiceStub.getPostMeeting(GetPostMeetingRequest.newBuilder()
                .setJobId(jobId).setUserId(userId.toString()).build()));
    }

    // 開始會後處理，回 202 與「執行中」的紀錄（已經有一份在跑就回那一份）。不能跑回 409 並附原因（預設模型是平台模型或
    // 不支援工具呼叫、沒有可用的已連結帳號），時區不對回 400。上傳時間取自 Job（換算相對日期用）。
    @PostMapping("/jobs/{jobId}/post-meeting")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public PostMeetingDto requestPostMeeting(@CurrentUserId UUID userId, @PathVariable String jobId,
            @RequestBody PostMeetingRequestDto request) {
        Job job = jobOwnershipGuard.fetch(userId, jobId);
        if (request == null || request.timezone() == null || request.timezone().isBlank()) {
            throw new IllegalArgumentException("timezone is required"); // → 400 via GrpcExceptionAdvice
        }
        return toDto(aiServiceStub.requestPostMeeting(RequestPostMeetingRequest.newBuilder()
                .setJobId(jobId)
                .setUserId(userId.toString())
                .setTimezone(request.timezone())
                .setUploadedAt(job.getCreatedAt())
                .build()));
    }

    // 用確認過的最終參數執行勾選的提案，回傳整份紀錄（每項的結果）；沒勾選的不動，已建立過的不再執行。還在跑回 409，
    // 提案不屬於這份紀錄回 400，紀錄不屬於這個 Job 回 404。
    @PostMapping("/jobs/{jobId}/post-meeting/{runId}/execute")
    public PostMeetingRunDto executeProposals(@CurrentUserId UUID userId, @PathVariable String jobId,
            @PathVariable String runId, @RequestBody ExecuteProposalsRequestDto request) {
        jobOwnershipGuard.check(userId, jobId);
        if (request == null || request.proposals() == null) {
            throw new IllegalArgumentException("proposals are required"); // → 400 via GrpcExceptionAdvice
        }
        ExecuteProposalsRequest.Builder grpcRequest = ExecuteProposalsRequest.newBuilder()
                .setJobId(jobId).setUserId(userId.toString()).setRunId(runId);
        for (ExecuteProposalsRequestDto.Item item : request.proposals()) {
            if (item == null || item.proposalId() == null || item.arguments() == null || !item.arguments().isObject()) {
                throw new IllegalArgumentException("each proposal needs proposalId and an arguments object");
            }
            grpcRequest.addProposals(ProposalToExecute.newBuilder()
                    .setProposalId(item.proposalId()).setArgumentsJson(item.arguments().toString()));
        }
        return toDto(aiServiceStub.executeProposals(grpcRequest.build()));
    }

    // 用上一次的最終參數重試一個失敗的提案；不是失敗的回 409。
    @PostMapping("/jobs/{jobId}/post-meeting/{runId}/proposals/{proposalId}/retry")
    public PostMeetingRunDto retryProposal(@CurrentUserId UUID userId, @PathVariable String jobId,
            @PathVariable String runId, @PathVariable String proposalId) {
        jobOwnershipGuard.check(userId, jobId);
        return toDto(aiServiceStub.retryProposal(RetryProposalRequest.newBuilder()
                .setJobId(jobId).setUserId(userId.toString()).setRunId(runId).setProposalId(proposalId).build()));
    }

    @GetMapping("/me/post-meeting-settings")
    public PostMeetingSettingsDto getSettings(@CurrentUserId UUID userId) {
        return toDto(aiServiceStub.getPostMeetingSettings(
                GetPostMeetingSettingsRequest.newBuilder().setUserId(userId.toString()).build()));
    }

    // 有指定的位置會先向 Notion 確認：沒連結 Notion 回 409，找不到、沒有權限或不是資料庫回 400（附原因），連不上 Notion 回 503。
    @PutMapping("/me/post-meeting-settings")
    public PostMeetingSettingsDto updateSettings(@CurrentUserId UUID userId,
            @RequestBody UpdatePostMeetingSettingsDto request) {
        UpdatePostMeetingSettingsDto body = request == null ? new UpdatePostMeetingSettingsDto(null, null, null) : request;
        return toDto(aiServiceStub.updatePostMeetingSettings(UpdatePostMeetingSettingsRequest.newBuilder()
                .setUserId(userId.toString())
                .setNotionMeetingsPageUrl(GrpcStrings.nullToEmpty(body.notionMeetingsPageUrl()))
                .setNotionTodoDatabaseUrl(GrpcStrings.nullToEmpty(body.notionTodoDatabaseUrl()))
                .setTodoDestination(todoDestination(body.todoDestination()))
                .build()));
    }

    private static TodoDestination todoDestination(String value) {
        if (value == null) {
            return TodoDestination.TODO_DESTINATION_UNSPECIFIED;
        }
        return switch (value) {
            case "GOOGLE_TASKS" -> TodoDestination.TODO_DESTINATION_GOOGLE_TASKS;
            case "NOTION" -> TodoDestination.TODO_DESTINATION_NOTION;
            default -> throw new IllegalArgumentException("todoDestination is GOOGLE_TASKS or NOTION"); // → 400
        };
    }

    private static PostMeetingSettingsDto toDto(PostMeetingSettings settings) {
        return new PostMeetingSettingsDto(
                settings.hasNotionMeetingsPage() ? toDto(settings.getNotionMeetingsPage()) : null,
                settings.hasNotionTodoDatabase() ? toDto(settings.getNotionTodoDatabase()) : null,
                settings.getTodoDestination().name().replace("TODO_DESTINATION_", ""));
    }

    private static PostMeetingSettingsDto.NotionLocationDto toDto(NotionLocation location) {
        return new PostMeetingSettingsDto.NotionLocationDto(location.getId(), location.getTitle(),
                GrpcStrings.emptyToNull(location.getUrl()));
    }

    private PostMeetingDto toDto(PostMeeting postMeeting) {
        return new PostMeetingDto(postMeeting.getAvailable(), GrpcStrings.emptyToNull(postMeeting.getUnavailableReason()),
                postMeeting.hasLatestRun() ? toDto(postMeeting.getLatestRun()) : null, postMeeting.getHintsList());
    }

    private PostMeetingRunDto toDto(PostMeetingRun run) {
        return new PostMeetingRunDto(run.getId(), run.getStatus().name().replace("POST_MEETING_STATUS_", ""),
                GrpcStrings.emptyToNull(run.getProgress()), GrpcStrings.emptyToNull(run.getFailureReason()),
                GrpcStrings.emptyToNull(run.getModelProvider()), GrpcStrings.emptyToNull(run.getModel()),
                GrpcTimestamps.toInstant(run.getRequestedAt()),
                run.hasFinishedAt() ? GrpcTimestamps.toInstant(run.getFinishedAt()) : null,
                run.getProposalsList().stream().map(this::toDto).toList());
    }

    private ActionProposalDto toDto(ActionProposal proposal) {
        try {
            return new ActionProposalDto(proposal.getId(), proposal.getService(), proposal.getTool(), proposal.getKind(),
                    objectMapper.readTree(proposal.getArgumentsJson()),
                    proposal.getStatus().name().replace("PROPOSAL_STATUS_", ""),
                    GrpcStrings.emptyToNull(proposal.getResultUrl()), GrpcStrings.emptyToNull(proposal.getFailureReason()));
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("ai-service sent proposal arguments that are not JSON", e);
        }
    }
}
