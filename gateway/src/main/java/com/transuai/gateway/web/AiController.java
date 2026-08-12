package com.transuai.gateway.web;

import java.util.List;
import java.util.UUID;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import com.transuai.gateway.grpc.JobOwnershipGuard;
import com.transuai.gateway.web.dto.ChapterDto;
import com.transuai.gateway.web.dto.QaAnswerDto;
import com.transuai.gateway.web.dto.QuestionRequestDto;
import com.transuai.gateway.web.dto.SummaryDto;

import lombok.RequiredArgsConstructor;
import transuai.ai.v1.Ai.AskQuestionRequest;
import transuai.ai.v1.Ai.AskQuestionResponse;
import transuai.ai.v1.Ai.Chapter;
import transuai.ai.v1.Ai.GetSummaryRequest;
import transuai.ai.v1.Ai.ListChaptersRequest;
import transuai.ai.v1.Ai.Summary;
import transuai.ai.v1.AiServiceGrpc;

// 對應 ../../architecture-design.md 3.4。AI Service MVP 階段做了 GetSummary + ListChapters +
// AskQuestion，export 那支 architecture-design.md 列的端點還沒有對應的 rpc 可轉發，這裡先不開
// （見 ../../ai-service/README.md 已知限制、gateway 自己的 README 已知限制）。
// 跟 TranscriptionController 一樣，AiService 不驗證 x-user-id，這裡呼叫前改用
// JobOwnershipGuard 先跟 upload-service 確認 job 的擁有者。
@RestController
@RequiredArgsConstructor
public class AiController {

    private final AiServiceGrpc.AiServiceBlockingStub aiServiceStub;
    private final JobOwnershipGuard jobOwnershipGuard;

    @GetMapping("/summary/{jobId}")
    public SummaryDto getSummary(@CurrentUserId UUID userId, @PathVariable String jobId) {
        jobOwnershipGuard.check(userId, jobId);
        Summary summary = aiServiceStub.getSummary(GetSummaryRequest.newBuilder().setJobId(jobId).build());
        return new SummaryDto(summary.getJobId(), summary.getSummaryText());
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

    @PostMapping("/qa/{jobId}")
    public QaAnswerDto askQuestion(@CurrentUserId UUID userId, @PathVariable String jobId,
            @RequestBody QuestionRequestDto request) {
        jobOwnershipGuard.check(userId, jobId);
        AskQuestionResponse response = aiServiceStub.askQuestion(AskQuestionRequest.newBuilder()
                .setJobId(jobId)
                .setUserId(userId.toString())
                .setQuestion(request.question())
                .build());
        return new QaAnswerDto(response.getAnswer(), response.getSourceTimestampsList());
    }
}
