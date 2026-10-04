package com.transuai.gateway.web;

import java.io.IOException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import com.transuai.gateway.grpc.GrpcMetadataSupport;
import com.transuai.gateway.grpc.GrpcStrings;
import com.transuai.gateway.grpc.GrpcTimestamps;
import com.transuai.gateway.grpc.JobOwnershipGuard;
import com.transuai.gateway.ratelimit.CostlyFeature;
import com.transuai.gateway.usage.UsageLimitGuard;
import com.transuai.gateway.web.dto.DecisionInputDto;
import com.transuai.gateway.web.dto.DecisionQuestionDto;
import com.transuai.gateway.web.dto.DecisionTimelineDto;
import com.transuai.gateway.web.dto.DecisionsDto;

import com.transuai.upload.grpc.v1.Job;
import com.transuai.upload.grpc.v1.ListJobsRequest;
import com.transuai.upload.grpc.v1.ListJobsResponse;
import com.transuai.upload.grpc.v1.UploadServiceGrpc;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import tools.jackson.databind.json.JsonMapper;
import transuai.ai.v1.Ai.AskDecisionsChunk;
import transuai.ai.v1.Ai.AskDecisionsRequest;
import transuai.ai.v1.Ai.CreateDecisionRequest;
import transuai.ai.v1.Ai.Decision;
import transuai.ai.v1.Ai.DecisionExtraction;
import transuai.ai.v1.Ai.DecisionInput;
import transuai.ai.v1.Ai.DecisionLink;
import transuai.ai.v1.Ai.DeleteDecisionRequest;
import transuai.ai.v1.Ai.GetJobDecisionsRequest;
import transuai.ai.v1.Ai.JobDecisions;
import transuai.ai.v1.Ai.ListUserDecisionsRequest;
import transuai.ai.v1.Ai.RequestDecisionExtractionRequest;
import transuai.ai.v1.Ai.SearchDecisionsRequest;
import transuai.ai.v1.Ai.UpdateDecisionRequest;
import transuai.ai.v1.AiServiceGrpc;

// 決策紀錄（見 ai-service/CONTEXT.md「決策」）：一個 Job 的決策在 ai-service 背景抽（會議、訪談轉錄完也會自動抽），前端輪詢直到不是
// GENERATING。
@RestController
@RequiredArgsConstructor
@Slf4j
public class DecisionController {

    // upload-service 一頁最多 100 個 Job。
    private static final int JOBS_PAGE_SIZE = 100;
    private static final JsonMapper JSON = JsonMapper.shared();

    private final AiServiceGrpc.AiServiceBlockingStub aiServiceStub;
    private final UploadServiceGrpc.UploadServiceBlockingStub uploadServiceStub;
    private final JobOwnershipGuard jobOwnershipGuard;
    private final UsageLimitGuard usageLimitGuard;

    // 抽出（或重新抽出）這場的決策：已經在抽就直接回傳它；重新抽只換掉 AI 抽的、使用者沒改過的。
    @CostlyFeature("decision-extraction")
    @PostMapping("/jobs/{jobId}/decisions/extract")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public DecisionsDto.Extraction extract(@CurrentUserId UUID userId, @PathVariable String jobId) {
        Job job = jobOwnershipGuard.fetch(userId, jobId);
        usageLimitGuard.requirePlatformTokensLeft(userId);
        RequestDecisionExtractionRequest.Builder request = RequestDecisionExtractionRequest.newBuilder()
                .setJobId(jobId).setUserId(userId.toString());
        if (job.hasCreatedAt()) {
            request.setMeetingAt(job.getCreatedAt()); // the meeting's date: which decisions are from earlier meetings
        }
        return toDto(aiServiceStub.requestDecisionExtraction(request.build()));
    }

    @GetMapping("/jobs/{jobId}/decisions")
    public DecisionsDto list(@CurrentUserId UUID userId, @PathVariable String jobId) {
        jobOwnershipGuard.check(userId, jobId);
        JobDecisions found = aiServiceStub.getJobDecisions(GetJobDecisionsRequest.newBuilder().setJobId(jobId).build());
        return new DecisionsDto(found.hasExtraction() ? toDto(found.getExtraction()) : null,
                found.getDecisionsList().stream().map(DecisionController::toDto).toList());
    }

    // 使用者自己新增一個決策（時間點可以沒有）；內容不合規則回 400 與原因。
    @PostMapping("/jobs/{jobId}/decisions")
    @ResponseStatus(HttpStatus.CREATED)
    public DecisionsDto.Item create(@CurrentUserId UUID userId, @PathVariable String jobId,
            @RequestBody DecisionInputDto body) {
        Job job = jobOwnershipGuard.fetch(userId, jobId);
        CreateDecisionRequest.Builder request = CreateDecisionRequest.newBuilder().setJobId(jobId)
                .setUserId(userId.toString()).setDecision(toInput(body));
        if (job.hasCreatedAt()) {
            request.setMeetingAt(job.getCreatedAt());
        }
        if (body != null && body.startTime() != null) {
            request.setStartTime(body.startTime());
        }
        return toDto(aiServiceStub.createDecision(request.build()));
    }

    // 修改內容（時間點與原話不變），之後重新抽也保留；不是這個 Job 的回 404。
    @PatchMapping("/jobs/{jobId}/decisions/{decisionId}")
    public DecisionsDto.Item update(@CurrentUserId UUID userId, @PathVariable String jobId,
            @PathVariable String decisionId, @RequestBody DecisionInputDto body) {
        jobOwnershipGuard.check(userId, jobId);
        return toDto(aiServiceStub.updateDecision(UpdateDecisionRequest.newBuilder().setJobId(jobId)
                .setDecisionId(decisionId).setDecision(toInput(body)).build()));
    }

    // AI 抽的只是隱藏（重新抽時不再出現），使用者新增的直接刪掉；不是這個 Job 的回 404。
    @DeleteMapping("/jobs/{jobId}/decisions/{decisionId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@CurrentUserId UUID userId, @PathVariable String jobId, @PathVariable String decisionId) {
        jobOwnershipGuard.check(userId, jobId);
        aiServiceStub.deleteDecision(DeleteDecisionRequest.newBuilder().setJobId(jobId).setDecisionId(decisionId).build());
    }

    // 決策頁：使用者所有 Job 的決策（時間軸），可以只看某個類型、某些 Job（jobId 可以給好幾個），或搜尋（字與意思）。先向 upload-service 列出使用者自己的
    // Job（類型的篩選在那裡，也帶來每個決策的 Job 標題與日期），再只問 ai-service 這些 Job 的決策——ai-service 另外依 user_id 過濾。
    @GetMapping("/decisions")
    public DecisionTimelineDto timeline(@CurrentUserId UUID userId, @RequestParam(defaultValue = "") String q,
            @RequestParam(defaultValue = "") String category,
            @RequestParam(name = "jobId", required = false) List<String> jobIds) {
        Map<String, Job> jobs = usersJobs(userId, category, jobIds);
        if (jobs.isEmpty()) {
            return new DecisionTimelineDto(List.of());
        }
        List<Decision> found = q.isBlank()
                ? aiServiceStub.listUserDecisions(ListUserDecisionsRequest.newBuilder().setUserId(userId.toString())
                        .addAllJobIds(jobs.keySet()).build()).getDecisionsList()
                : aiServiceStub.searchDecisions(SearchDecisionsRequest.newBuilder().setUserId(userId.toString())
                        .setQuery(q.strip()).addAllJobIds(jobs.keySet()).build()).getDecisionsList();
        List<DecisionTimelineDto.Item> items = new ArrayList<>(timelineItems(found, jobs));
        if (q.isBlank()) {
            // Newest meeting first; within one, the order ai-service gave (by time). The sort is stable.
            items.sort(Comparator.comparing((DecisionTimelineDto.Item item) -> item.job().createdAt(),
                    Comparator.nullsLast(Comparator.reverseOrder())));
        }
        return new DecisionTimelineDto(items);
    }

    // The user's own jobs (of a category; only the chosen ones when some are), by id: what may be asked about, and what each
    // decision belongs to. Every page of them on each call — fine for now; a user with very many jobs would want this
    // narrowed in upload-service instead.
    private Map<String, Job> usersJobs(UUID userId, String category, List<String> chosen) {
        Map<String, Job> jobs = new LinkedHashMap<>();
        int seen = 0;
        for (int page = 1;; page++) {
            ListJobsResponse response = GrpcMetadataSupport.withUserId(uploadServiceStub, userId).listJobs(
                    ListJobsRequest.newBuilder().setPage(page).setPageSize(JOBS_PAGE_SIZE).setCategory(category).build());
            for (Job job : response.getJobsList()) {
                if (chosen == null || chosen.isEmpty() || chosen.contains(job.getJobId())) {
                    jobs.put(job.getJobId(), job);
                }
            }
            seen += response.getJobsCount();
            if (response.getJobsCount() == 0 || seen >= response.getTotalCount()) {
                return jobs;
            }
        }
    }

    private static List<DecisionTimelineDto.Item> timelineItems(List<Decision> decisions, Map<String, Job> jobs) {
        return decisions.stream()
                .filter(decision -> jobs.containsKey(decision.getJobId()))
                .map(decision -> new DecisionTimelineDto.Item(toSummary(jobs.get(decision.getJobId())), toDto(decision)))
                .toList();
    }

    private static DecisionTimelineDto.JobSummary toSummary(Job job) {
        return new DecisionTimelineDto.JobSummary(job.getJobId(), GrpcStrings.emptyToNull(job.getTitle()),
                job.getFileName(), GrpcStrings.emptyToNull(job.getCategory()),
                job.hasCreatedAt() ? GrpcTimestamps.toInstant(job.getCreatedAt()) : null);
    }

    // 問決策（SSE，跟問答一樣經 Gateway 轉發，見 AiController.askQuestion）：只根據使用者自己的決策回答（範圍跟決策頁的篩選一樣），
    // 先送 sources（依據的決策，帶它們的 Job；順序就是回答裡 [n] 的編號），再送 model 與 delta；失敗送 error。
    @CostlyFeature("decision-question")
    @PostMapping(value = "/decisions/ask", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter ask(@CurrentUserId UUID userId, @RequestBody DecisionQuestionDto body) {
        if (body == null || body.question() == null || body.question().isBlank()) {
            throw new IllegalArgumentException("question is required"); // → 400 via GrpcExceptionAdvice
        }
        usageLimitGuard.requirePlatformTokensLeft(userId);
        Map<String, Job> jobs = usersJobs(userId, body.category() == null ? "" : body.category(), body.jobIds());
        Iterator<AskDecisionsChunk> chunks = aiServiceStub.askDecisions(AskDecisionsRequest.newBuilder()
                .setUserId(userId.toString()).setQuestion(body.question().strip()).addAllJobIds(jobs.keySet()).build());
        // As askQuestion: take the first chunk here, so a gRPC error still becomes an ordinary error response.
        if (!chunks.hasNext()) {
            throw new IllegalStateException("ai-service closed the AskDecisions stream without any chunk");
        }
        AskDecisionsChunk first = chunks.next();
        SseEmitter emitter = new SseEmitter(0L);
        Thread.ofVirtual().start(() -> {
            try {
                send(emitter, first, jobs);
                while (chunks.hasNext()) {
                    send(emitter, chunks.next(), jobs);
                }
                emitter.complete();
            } catch (Exception e) {
                log.warn("AskDecisions SSE relay failed", e);
                emitter.completeWithError(e);
            }
        });
        return emitter;
    }

    // data 一律是單行 JSON（見 AiController.send）；java.time 用 Jackson 3 預設的 ISO 字串。
    private void send(SseEmitter emitter, AskDecisionsChunk chunk, Map<String, Job> jobs) throws IOException {
        switch (chunk.getPayloadCase()) {
            case SOURCES -> emitter.send(SseEmitter.event().name("sources").data(JSON.writeValueAsString(
                    timelineItems(chunk.getSources().getDecisionsList(), jobs))));
            case DELTA -> emitter.send(SseEmitter.event().name("delta").data(JSON.writeValueAsString(chunk.getDelta())));
            case ERROR -> emitter.send(SseEmitter.event().name("error").data(JSON.writeValueAsString(chunk.getError())));
            case ANSWERED_BY -> emitter.send(SseEmitter.event().name("model").data(JSON.writeValueAsString(
                    Map.of("provider", chunk.getAnsweredBy().getProvider(), "model", chunk.getAnsweredBy().getModel()))));
            case PAYLOAD_NOT_SET -> log.warn("AskDecisionsChunk with no payload set, skipping");
        }
    }

    private static DecisionInput toInput(DecisionInputDto body) {
        if (body == null) {
            return DecisionInput.getDefaultInstance(); // → 400 from ai-service: 決定不能是空的
        }
        return DecisionInput.newBuilder()
                .setStatement(body.statement() == null ? "" : body.statement())
                .setRationale(body.rationale() == null ? "" : body.rationale())
                .addAllAlternatives(body.alternatives() == null ? List.of() : body.alternatives())
                .setProposedBy(body.proposedBy() == null ? "" : body.proposedBy())
                .setTentative(Boolean.TRUE.equals(body.tentative()))
                .build();
    }

    private static DecisionsDto.Extraction toDto(DecisionExtraction extraction) {
        String status = switch (extraction.getStatus()) {
            case DECISION_EXTRACTION_STATUS_GENERATING -> "GENERATING";
            case DECISION_EXTRACTION_STATUS_COMPLETED -> "COMPLETED";
            default -> "FAILED";
        };
        return new DecisionsDto.Extraction(status, GrpcStrings.emptyToNull(extraction.getFailureReason()),
                extraction.getSourceRevision(), GrpcStrings.emptyToNull(extraction.getModelProvider()),
                GrpcStrings.emptyToNull(extraction.getModel()),
                extraction.hasRequestedAt() ? GrpcTimestamps.toInstant(extraction.getRequestedAt()) : null,
                extraction.hasCompletedAt() ? GrpcTimestamps.toInstant(extraction.getCompletedAt()) : null);
    }

    private static DecisionsDto.Item toDto(Decision decision) {
        return new DecisionsDto.Item(decision.getId(), decision.getJobId(), decision.getStatement(),
                decision.getRationale(), decision.getAlternativesList(), GrpcStrings.emptyToNull(decision.getProposedBy()),
                GrpcStrings.emptyToNull(decision.getProposedByName()),
                decision.getTentative(), decision.hasStartTime() ? decision.getStartTime() : null,
                GrpcStrings.emptyToNull(decision.getEvidenceText()), decision.getSource(), decision.getEdited(),
                decision.hasSupersedes() ? toLink(decision.getSupersedes()) : null,
                decision.getSupersededByList().stream().map(DecisionController::toLink).toList(),
                decision.hasMeetingAt() ? GrpcTimestamps.toInstant(decision.getMeetingAt()) : null,
                decision.hasCreatedAt() ? GrpcTimestamps.toInstant(decision.getCreatedAt()) : null);
    }

    private static DecisionsDto.Link toLink(DecisionLink link) {
        return new DecisionsDto.Link(link.getId(), link.getJobId(), link.getStatement(),
                link.hasMeetingAt() ? GrpcTimestamps.toInstant(link.getMeetingAt()) : null);
    }
}
