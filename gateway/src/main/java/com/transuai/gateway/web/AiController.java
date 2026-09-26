package com.transuai.gateway.web;

import java.io.IOException;
import java.util.Iterator;
import java.util.List;
import java.util.UUID;

import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.transuai.gateway.grpc.GrpcTimestamps;
import com.transuai.gateway.grpc.JobOwnershipGuard;
import com.transuai.gateway.web.dto.ChapterDto;
import com.transuai.gateway.web.dto.QaTurnDto;
import com.transuai.gateway.web.dto.QuestionRequestDto;
import com.transuai.gateway.web.dto.SummaryDto;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import transuai.ai.v1.Ai.AskQuestionChunk;
import transuai.ai.v1.Ai.AskQuestionRequest;
import transuai.ai.v1.Ai.Chapter;
import transuai.ai.v1.Ai.GetSummaryRequest;
import transuai.ai.v1.Ai.ListChaptersRequest;
import transuai.ai.v1.Ai.ListQaHistoryRequest;
import transuai.ai.v1.Ai.Summary;
import transuai.ai.v1.AiServiceGrpc;

// 對應 ../../architecture-design.md 3.4。AI Service MVP 階段做了 GetSummary + ListChapters +
// AskQuestion（對話記憶 + streaming）+ ListQaHistory，export 那支 architecture-design.md 列的
// 端點還沒有對應的 rpc 可轉發，這裡先不開（見 ../../ai-service/README.md 已知限制、gateway 自己
// 的 README 已知限制）。
// 跟 TranscriptionController 一樣，AiService 不驗證 x-user-id，這裡呼叫前改用
// JobOwnershipGuard 先跟 upload-service 確認 job 的擁有者。
@RestController
@RequiredArgsConstructor
@Slf4j
public class AiController {

    private final AiServiceGrpc.AiServiceBlockingStub aiServiceStub;
    private final JobOwnershipGuard jobOwnershipGuard;
    // 不透過 Spring 注入 JacksonAutoConfiguration 產生的 ObjectMapper bean，理由跟
    // JwtAuthenticationFilter 的同名欄位一樣：這個專案的 Spring context 初始化順序下，
    // 依賴注入 ObjectMapper 會炸 UnsatisfiedDependencyException（開發時實測踩到，這裡是
    // 目前第二個踩到的地方）。這裡只是把幾個基本型別（String/List<Double>）序列化成 JSON
    // 字串塞進 SSE data 欄位，不需要專案自訂的 Jackson module，自己 new 最單純、最穩。
    private final ObjectMapper objectMapper = new ObjectMapper();

    @GetMapping("/summary/{jobId}")
    public SummaryDto getSummary(@CurrentUserId UUID userId, @PathVariable String jobId) {
        jobOwnershipGuard.check(userId, jobId);
        Summary summary = aiServiceStub.getSummary(GetSummaryRequest.newBuilder().setJobId(jobId).build());
        return new SummaryDto(summary.getJobId(), summary.getSummaryText(), summary.getSourceRevision());
    }

    @GetMapping("/chapters/{jobId}")
    public List<ChapterDto> getChapters(@CurrentUserId UUID userId, @PathVariable String jobId) {
        jobOwnershipGuard.check(userId, jobId);
        List<Chapter> chapters = aiServiceStub
                .listChapters(ListChaptersRequest.newBuilder().setJobId(jobId).build())
                .getChaptersList();
        return chapters.stream()
                .map(c -> new ChapterDto(c.getId(), c.getJobId(), c.getTitle(), c.getStartTime(), c.getSequenceNo()))
                .toList();
    }

    // 「對話」的範圍是整個 job，沒有獨立的 conversation/thread 概念（見
    // ai-service/docs/adr/ 對話範圍的 ADR），所以歷史紀錄不分頁、不分組，一次回全部。
    @GetMapping("/qa/{jobId}")
    public List<QaTurnDto> getQaHistory(@CurrentUserId UUID userId, @PathVariable String jobId) {
        jobOwnershipGuard.check(userId, jobId);
        return aiServiceStub
                .listQaHistory(ListQaHistoryRequest.newBuilder().setJobId(jobId).build())
                .getTurnsList().stream()
                .map(t -> new QaTurnDto(t.getQuestion(), t.getAnswer(), t.getSourceTimestampsList(),
                        GrpcTimestamps.toInstant(t.getCreatedAt())))
                .toList();
    }

    // SSE，見 ../../docs/adr/ SSE-via-Gateway 的 ADR：單向伺服器推送不需要 WebSocket 的雙向能力，
    // 而且維持「查詢一律經 Gateway 轉發」的既有原則（跟 notification-service 的 WS 不同，那是
    // 推播、這裡是查詢）。前端用 fetch + 手動解析 SSE frame，不是原生 EventSource——因為
    // EventSource 無法附加 Authorization header，這個 gateway 全部端點都是 Bearer JWT 驗證。
    @PostMapping(value = "/qa/{jobId}", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter askQuestion(@CurrentUserId UUID userId, @PathVariable String jobId,
            @RequestBody QuestionRequestDto request) {
        jobOwnershipGuard.check(userId, jobId);

        Iterator<AskQuestionChunk> chunks = aiServiceStub.askQuestion(AskQuestionRequest.newBuilder()
                .setJobId(jobId)
                .setUserId(userId.toString())
                .setQuestion(request.question())
                .build());

        // 同步先拉第一個 chunk（ai-service 保證是 sources，見 ai.proto 的註解）：這是唯一會讓
        // StatusRuntimeException 冒出來的時機點（例如這個 job 還沒有 embedding 對應的
        // NOT_FOUND），讓它在這裡往外拋，走跟其他端點一樣的 GrpcExceptionAdvice，回傳一般的
        // JSON 錯誤 response——這時候 HTTP response 都還沒開始送，還來得及回一個正常的錯誤
        // status，不用硬塞進 SSE error event。過了這一步才正式開始這個 request 的 SSE 串流。
        if (!chunks.hasNext()) {
            throw new IllegalStateException("ai-service closed the AskQuestion stream without any chunk");
        }
        AskQuestionChunk first = chunks.next();

        SseEmitter emitter = new SseEmitter(0L); // 不設 timeout，串流長度取決於 LLM 生成時間
        Thread.ofVirtual().start(() -> relay(emitter, first, chunks));
        return emitter;
    }

    private void relay(SseEmitter emitter, AskQuestionChunk first, Iterator<AskQuestionChunk> chunks) {
        try {
            send(emitter, first);
            while (chunks.hasNext()) {
                send(emitter, chunks.next());
            }
            emitter.complete();
        } catch (Exception e) {
            log.warn("AskQuestion SSE relay failed", e);
            emitter.completeWithError(e);
        }
    }

    // data 一律手動 JSON encode 成單行字串，不靠 SseEmitter 對多行字串的預設分行行為——
    // 前端那邊手動解析 SSE frame（見 askQuestion 上面的註解），單行 data 比較好處理。
    private void send(SseEmitter emitter, AskQuestionChunk chunk) throws IOException {
        switch (chunk.getPayloadCase()) {
            case SOURCES -> emitter.send(SseEmitter.event().name("sources")
                    .data(objectMapper.writeValueAsString(chunk.getSources().getSourceTimestampsList())));
            case DELTA -> emitter.send(SseEmitter.event().name("delta")
                    .data(objectMapper.writeValueAsString(chunk.getDelta())));
            case ERROR -> emitter.send(SseEmitter.event().name("error")
                    .data(objectMapper.writeValueAsString(chunk.getError())));
            case PAYLOAD_NOT_SET -> log.warn("AskQuestionChunk with no payload set, skipping");
        }
    }
}
