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
import com.transuai.gateway.web.dto.QuizAttemptRequestDto;
import com.transuai.gateway.web.dto.QuizAttemptResultDto;
import com.transuai.gateway.web.dto.QuizDto;
import com.transuai.gateway.web.dto.QuizQuestionDto;
import com.transuai.gateway.web.dto.QuizQuestionResultDto;
import com.transuai.gateway.web.dto.QuizRequestDto;

import lombok.RequiredArgsConstructor;
import transuai.ai.v1.Ai.GetQuizRequest;
import transuai.ai.v1.Ai.ListQuizzesRequest;
import transuai.ai.v1.Ai.Quiz;
import transuai.ai.v1.Ai.QuizAttemptResult;
import transuai.ai.v1.Ai.QuizQuestion;
import transuai.ai.v1.Ai.RequestQuizRequest;
import transuai.ai.v1.Ai.SubmitQuizAttemptRequest;
import transuai.ai.v1.AiServiceGrpc;

// 測驗（見 ai-service/CONTEXT.md「測驗」）：在 ai-service 背景產生，前端輪詢列表直到不是 GENERATING。
@RestController
@RequiredArgsConstructor
public class QuizController {

    private final AiServiceGrpc.AiServiceBlockingStub aiServiceStub;
    private final JobOwnershipGuard jobOwnershipGuard;

    // 每次都多一份新的測驗（舊的保留）；回傳「產生中」的測驗，不含題目。題數不是 5、10、20 回 400。
    @PostMapping("/jobs/{jobId}/quizzes")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public QuizDto requestQuiz(@CurrentUserId UUID userId, @PathVariable String jobId,
            @RequestBody QuizRequestDto request) {
        jobOwnershipGuard.check(userId, jobId);
        if (request == null || request.questionCount() == null) {
            throw new IllegalArgumentException("questionCount is required"); // → 400 via GrpcExceptionAdvice
        }
        return toDto(aiServiceStub.requestQuiz(RequestQuizRequest.newBuilder()
                .setJobId(jobId)
                .setUserId(userId.toString())
                .setQuestionCount(request.questionCount())
                .build()), false);
    }

    // 新的在前，不含題目。
    @GetMapping("/jobs/{jobId}/quizzes")
    public List<QuizDto> listQuizzes(@CurrentUserId UUID userId, @PathVariable String jobId) {
        jobOwnershipGuard.check(userId, jobId);
        return aiServiceStub.listQuizzes(ListQuizzesRequest.newBuilder().setJobId(jobId).build())
                .getQuizzesList().stream()
                .map(quiz -> toDto(quiz, false))
                .toList();
    }

    // 含題目與正確答案（測驗屬於使用者自己，作答時不顯示答案是前端的事）。不屬於這個 Job 回 404。
    @GetMapping("/jobs/{jobId}/quizzes/{quizId}")
    public QuizDto getQuiz(@CurrentUserId UUID userId, @PathVariable String jobId, @PathVariable String quizId) {
        jobOwnershipGuard.check(userId, jobId);
        return toDto(aiServiceStub.getQuiz(GetQuizRequest.newBuilder().setJobId(jobId).setQuizId(quizId).build()),
                true);
    }

    // 後端計分並保存（同一份測驗可以重做，每次都保存）；每題要剛好一個有效選項，否則 400；還沒產生完成回 409。
    @PostMapping("/jobs/{jobId}/quizzes/{quizId}/attempts")
    public QuizAttemptResultDto submitAttempt(@CurrentUserId UUID userId, @PathVariable String jobId,
            @PathVariable String quizId, @RequestBody QuizAttemptRequestDto request) {
        jobOwnershipGuard.check(userId, jobId);
        if (request == null || request.answers() == null || request.answers().contains(null)) {
            throw new IllegalArgumentException("answers are required"); // → 400 via GrpcExceptionAdvice
        }
        QuizAttemptResult result = aiServiceStub.submitQuizAttempt(SubmitQuizAttemptRequest.newBuilder()
                .setJobId(jobId)
                .setQuizId(quizId)
                .setUserId(userId.toString())
                .addAllAnswers(request.answers())
                .build());
        return new QuizAttemptResultDto(result.getCorrectCount(), result.getQuestionCount(),
                result.getResultsList().stream()
                        .map(r -> new QuizQuestionResultDto(r.getChosenOption(), r.getCorrectOption(), r.getCorrect(),
                                r.getExplanation()))
                        .toList());
    }

    private static QuizDto toDto(Quiz quiz, boolean withQuestions) {
        return new QuizDto(quiz.getId(), quiz.getJobId(), quiz.getQuestionCount(),
                quiz.getStatus().name().replace("QUIZ_STATUS_", ""), GrpcStrings.emptyToNull(quiz.getFailureReason()),
                quiz.getSourceRevision(), GrpcStrings.emptyToNull(quiz.getModelProvider()),
                GrpcStrings.emptyToNull(quiz.getModel()), GrpcTimestamps.toInstant(quiz.getRequestedAt()),
                quiz.hasCompletedAt() ? GrpcTimestamps.toInstant(quiz.getCompletedAt()) : null,
                withQuestions ? quiz.getQuestionsList().stream().map(QuizController::toDto).toList() : null,
                quiz.hasBestCorrectCount() ? quiz.getBestCorrectCount() : null);
    }

    private static QuizQuestionDto toDto(QuizQuestion question) {
        return new QuizQuestionDto(question.getKind(), question.getPrompt(), question.getOptionsList(),
                question.getCorrectOption(), question.getExplanation(), question.getSourceTimestampsList());
    }
}
