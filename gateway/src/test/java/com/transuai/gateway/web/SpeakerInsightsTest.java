package com.transuai.gateway.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;

import com.transuai.gateway.RedisContainerConfig;
import com.transuai.gateway.TestAuth;
import com.transuai.gateway.security.JwtProperties;
import com.transuai.upload.grpc.v1.Job;
import com.transuai.upload.grpc.v1.UploadServiceGrpc;

import io.grpc.Status;
import transuai.ai.v1.Ai.ModelChoice;
import transuai.ai.v1.Ai.RequestSpeakerInsightsRequest;
import transuai.ai.v1.Ai.SpeakerInsight;
import transuai.ai.v1.Ai.SpeakerInsights;
import transuai.ai.v1.Ai.SpeakerInsightsStatus;
import transuai.ai.v1.AiServiceGrpc;

/** 講者數據的 AI 判斷（見 .scratch/speaker-analytics/issues/02）：要求分析與取得，先過 ownership，要求分析是花錢的功能。 */
@SpringBootTest
@AutoConfigureMockMvc
@Import(RedisContainerConfig.class)
class SpeakerInsightsTest {

    private static final String JOB = "22222222-2222-2222-2222-222222222222";

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

    private final UUID user = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        redis.getConnectionFactory().getConnection().serverCommands().flushAll();
        when(uploadServiceStub.withInterceptors(any())).thenReturn(uploadServiceStub);
        when(uploadServiceStub.getJob(any())).thenReturn(Job.getDefaultInstance());
        // Not the platform model: no monthly cap to look up.
        when(aiServiceStub.getDefaultModel(any())).thenReturn(ModelChoice.newBuilder().setProvider("openai").build());
    }

    @Test
    void aJobNeverAnalyzedIsNone() throws Exception {
        when(aiServiceStub.getSpeakerInsights(any())).thenReturn(SpeakerInsights.newBuilder().setJobId(JOB).build());

        call(MockMvcRequestBuilders.get("/jobs/" + JOB + "/speaker-insights"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("NONE"))
                .andExpect(jsonPath("$.items").isEmpty());
    }

    @Test
    void theResultCarriesEachQuestionAndInterruption() throws Exception {
        when(aiServiceStub.getSpeakerInsights(any())).thenReturn(SpeakerInsights.newBuilder().setJobId(JOB)
                .setStatus(SpeakerInsightsStatus.SPEAKER_INSIGHTS_STATUS_COMPLETED).setSourceRevision(3).setModel("qwen")
                .addItems(SpeakerInsight.newBuilder().setKind("question").setSpeakerLabel("S1").setStartTime(1.5).setText("大家覺得呢"))
                .addItems(SpeakerInsight.newBuilder().setKind("interruption").setSpeakerLabel("S2").setInterruptedLabel("S1")
                        .setStartTime(9).setText("等一下"))
                .build());

        call(MockMvcRequestBuilders.get("/jobs/" + JOB + "/speaker-insights"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("COMPLETED"))
                .andExpect(jsonPath("$.sourceRevision").value(3))
                .andExpect(jsonPath("$.items[0].kind").value("question"))
                .andExpect(jsonPath("$.items[0].interruptedLabel").doesNotExist())
                .andExpect(jsonPath("$.items[1].interruptedLabel").value("S1"))
                .andExpect(jsonPath("$.items[1].text").value("等一下"));
    }

    @Test
    void askingForAnAnalysisPassesTheUserOnAndIsAccepted() throws Exception {
        when(aiServiceStub.requestSpeakerInsights(any())).thenReturn(SpeakerInsights.newBuilder().setJobId(JOB)
                .setStatus(SpeakerInsightsStatus.SPEAKER_INSIGHTS_STATUS_GENERATING).build());

        call(MockMvcRequestBuilders.post("/jobs/" + JOB + "/speaker-insights"))
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.status").value("GENERATING"));

        ArgumentCaptor<RequestSpeakerInsightsRequest> sent = ArgumentCaptor.forClass(RequestSpeakerInsightsRequest.class);
        verify(aiServiceStub).requestSpeakerInsights(sent.capture());
        assertThat(sent.getValue().getUserId()).isEqualTo(user.toString());
    }

    @Test
    void askingTooOftenIsRateLimited() throws Exception {
        when(aiServiceStub.requestSpeakerInsights(any())).thenReturn(SpeakerInsights.getDefaultInstance());

        for (int i = 0; i < 10; i++) {
            call(MockMvcRequestBuilders.post("/jobs/" + JOB + "/speaker-insights")).andExpect(status().isAccepted());
        }
        call(MockMvcRequestBuilders.post("/jobs/" + JOB + "/speaker-insights")).andExpect(status().isTooManyRequests());
    }

    @Test
    void someoneElsesJobIsNotFound() throws Exception {
        when(uploadServiceStub.getJob(any())).thenThrow(Status.NOT_FOUND.asRuntimeException());

        call(MockMvcRequestBuilders.post("/jobs/" + JOB + "/speaker-insights")).andExpect(status().isNotFound());
        verify(aiServiceStub, never()).requestSpeakerInsights(any());
    }

    private ResultActions call(MockHttpServletRequestBuilder request) throws Exception {
        return mvc.perform(request.header("Authorization", "Bearer " + TestAuth.accessToken(jwt, user)));
    }
}
