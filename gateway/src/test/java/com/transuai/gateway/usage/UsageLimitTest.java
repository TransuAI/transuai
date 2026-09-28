package com.transuai.gateway.usage;

import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.not;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Date;
import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;

import com.transuai.gateway.RedisContainerConfig;
import com.transuai.gateway.security.JwtProperties;
import com.transuai.upload.grpc.v1.GetPresignedUploadUrlResponse;
import com.transuai.upload.grpc.v1.Job;
import com.transuai.upload.grpc.v1.UploadServiceGrpc;

import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import transuai.ai.v1.Ai.AskQuestionChunk;
import transuai.ai.v1.Ai.LlmUsageSum;
import transuai.ai.v1.Ai.ModelChoice;
import transuai.ai.v1.Ai.Quiz;
import transuai.ai.v1.Ai.SumUserLlmUsageResponse;
import transuai.ai.v1.AiServiceGrpc;
import transuai.transcription.v1.Transcription.SumUserTranscriptionUsageResponse;
import transuai.transcription.v1.Transcription.TranscriptionUsageSum;
import transuai.transcription.v1.TranscriptionServiceGrpc;

/** 每月用量上限（見 .scratch/pre-launch-hardening/issues/04）：轉錄分鐘數與平台模型的 token，這裡調小。 */
@SpringBootTest(properties = {
        "app.usage-limits.transcription-minutes=60", "app.usage-limits.platform-tokens=1000",
})
@AutoConfigureMockMvc
@Import(RedisContainerConfig.class)
class UsageLimitTest {

    private static final String JOB = "11111111-1111-1111-1111-111111111111";

    @Autowired
    private MockMvc mvc;

    @Autowired
    private StringRedisTemplate redis;

    @Autowired
    private JwtProperties jwt;

    @MockitoBean
    private UploadServiceGrpc.UploadServiceBlockingStub uploadServiceStub;

    @MockitoBean
    private AiServiceGrpc.AiServiceBlockingStub aiServiceStub;

    @MockitoBean
    private TranscriptionServiceGrpc.TranscriptionServiceBlockingStub transcriptionServiceStub;

    private final UUID user = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        redis.getConnectionFactory().getConnection().serverCommands().flushAll();
        when(uploadServiceStub.withInterceptors(any())).thenReturn(uploadServiceStub);
        when(uploadServiceStub.getJob(any())).thenReturn(Job.getDefaultInstance());
        when(uploadServiceStub.getPresignedUploadUrl(any())).thenReturn(GetPresignedUploadUrlResponse.getDefaultInstance());
        when(aiServiceStub.requestQuiz(any())).thenReturn(Quiz.getDefaultInstance());
        when(aiServiceStub.askQuestion(any())).thenAnswer(call -> List.of(AskQuestionChunk.getDefaultInstance()).iterator());
        usedThisMonth(0, 0, 0);
        defaultModel("platform");
    }

    @Test
    void uploadingStopsOnceThisMonthsTranscriptionMinutesAreUsedUp() throws Exception {
        usedThisMonth(60 * 60, 0, 0);

        presign().andExpect(status().isTooManyRequests())
                .andExpect(jsonPath("$.error").value("USAGE_LIMIT_REACHED"))
                .andExpect(jsonPath("$.message").value(containsString("60 分鐘")))
                .andExpect(header().exists("Retry-After"));  // 到下個月 1 日
        verify(uploadServiceStub, never()).getPresignedUploadUrl(any());
    }

    @Test
    void uploadingWorksWhileMinutesAreLeft() throws Exception {
        usedThisMonth(59 * 60, 0, 0);

        presign().andExpect(status().isOk());
    }

    @Test
    void thePlatformModelStopsOnceThisMonthsTokensAreUsedUp() throws Exception {
        usedThisMonth(0, 600, 400);

        requestQuiz().andExpect(status().isTooManyRequests())
                .andExpect(jsonPath("$.message").value(containsString("自有金鑰")));
        verify(aiServiceStub, never()).requestQuiz(any());
    }

    @Test
    void ownKeyModelsAreNotLimited() throws Exception {
        usedThisMonth(0, 600, 400);
        defaultModel("openai");

        requestQuiz().andExpect(status().isAccepted());
    }

    @Test
    void tokensUsedWithOwnKeysDoNotCountTowardThePlatformLimit() throws Exception {
        when(aiServiceStub.sumUserLlmUsage(any())).thenReturn(SumUserLlmUsageResponse.newBuilder()
                .addSums(LlmUsageSum.newBuilder().setKeySource("own").setInputTokens(5000).setOutputTokens(5000))
                .build());

        requestQuiz().andExpect(status().isAccepted());
    }

    @Test
    void aQuestionForAnOwnKeyModelIsAllowedEvenWhenThePlatformLimitIsReached() throws Exception {
        usedThisMonth(0, 600, 400);

        ask("{\"question\":\"q\",\"model\":{\"provider\":\"openai\",\"model\":\"gpt-5\",\"supportsTools\":true}}")
                .andExpect(status().is(not(429)));
        verify(aiServiceStub).askQuestion(any());
        ask("{\"question\":\"q\"}").andExpect(status().isTooManyRequests());  // 沒指定就是預設模型：平台模型
    }

    @Test
    void thisMonthsUsageComesWithTheLimits() throws Exception {
        call(MockMvcRequestBuilders.get("/me/usage"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.limits.transcriptionMinutes").value(60))
                .andExpect(jsonPath("$.limits.platformTokens").value(1000));
    }

    private void usedThisMonth(double transcriptionSeconds, long platformInput, long platformOutput) {
        when(transcriptionServiceStub.sumUserTranscriptionUsage(any())).thenReturn(SumUserTranscriptionUsageResponse
                .newBuilder().addSums(TranscriptionUsageSum.newBuilder().setAudioSeconds(transcriptionSeconds)).build());
        when(aiServiceStub.sumUserLlmUsage(any())).thenReturn(SumUserLlmUsageResponse.newBuilder()
                .addSums(LlmUsageSum.newBuilder().setKeySource("platform").setInputTokens(platformInput)
                        .setOutputTokens(platformOutput))
                .build());
    }

    private void defaultModel(String provider) {
        when(aiServiceStub.getDefaultModel(any())).thenReturn(ModelChoice.newBuilder().setProvider(provider).build());
    }

    private ResultActions presign() throws Exception {
        return call(MockMvcRequestBuilders.post("/uploads/presign").contentType(MediaType.APPLICATION_JSON)
                .content("{\"fileName\":\"a.mp3\",\"fileType\":\"AUDIO\",\"fileSizeBytes\":1000}"));
    }

    private ResultActions requestQuiz() throws Exception {
        return call(MockMvcRequestBuilders.post("/jobs/" + JOB + "/quizzes").contentType(MediaType.APPLICATION_JSON)
                .content("{\"questionCount\":5}"));
    }

    private ResultActions ask(String body) throws Exception {
        return call(MockMvcRequestBuilders.post("/qa/" + JOB).contentType(MediaType.APPLICATION_JSON).content(body));
    }

    private ResultActions call(MockHttpServletRequestBuilder request) throws Exception {
        String token = Jwts.builder().subject(user.toString()).claim("type", "access")
                .expiration(Date.from(Instant.now().plusSeconds(600)))
                .signWith(Keys.hmacShaKeyFor(jwt.secret().getBytes(StandardCharsets.UTF_8))).compact();
        return mvc.perform(request.header("Authorization", "Bearer " + token));
    }
}
