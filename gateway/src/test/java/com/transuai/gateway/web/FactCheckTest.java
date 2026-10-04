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
import transuai.ai.v1.Ai.Claim;
import transuai.ai.v1.Ai.ClaimSource;
import transuai.ai.v1.Ai.FactCheck;
import transuai.ai.v1.Ai.FactCheckStatus;
import transuai.ai.v1.Ai.JobFactCheck;
import transuai.ai.v1.Ai.ModelChoice;
import transuai.ai.v1.Ai.RequestFactCheckRequest;
import transuai.ai.v1.AiServiceGrpc;

/** 事實查核（見 .scratch/fact-check/issues/01）：標出主張與取得，先過 ownership；標出主張是花錢的功能。 */
@SpringBootTest
@AutoConfigureMockMvc
@Import(RedisContainerConfig.class)
class FactCheckTest {

    private static final String JOB = "66666666-6666-6666-6666-666666666666";

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

    private final FactCheck finding = FactCheck.newBuilder().setJobId(JOB)
            .setStatus(FactCheckStatus.FACT_CHECK_STATUS_GENERATING).build();

    @BeforeEach
    void setUp() {
        redis.getConnectionFactory().getConnection().serverCommands().flushAll();
        when(uploadServiceStub.withInterceptors(any())).thenReturn(uploadServiceStub);
        when(uploadServiceStub.getJob(any())).thenReturn(Job.getDefaultInstance());
        when(aiServiceStub.getDefaultModel(any())).thenReturn(ModelChoice.newBuilder().setProvider("openai").build());
    }

    @Test
    void findingClaimsPassesTheUserOn() throws Exception {
        when(aiServiceStub.requestFactCheck(any())).thenReturn(finding);

        call(MockMvcRequestBuilders.post("/jobs/" + JOB + "/fact-check"))
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.status").value("GENERATING"));

        ArgumentCaptor<RequestFactCheckRequest> sent = ArgumentCaptor.forClass(RequestFactCheckRequest.class);
        verify(aiServiceStub).requestFactCheck(sent.capture());
        assertThat(sent.getValue().getUserId()).isEqualTo(user.toString());
    }

    @Test
    void theClaimsComeWithTheirVerdictsAndSources() throws Exception {
        when(aiServiceStub.getFactCheck(any())).thenReturn(JobFactCheck.newBuilder()
                .setExtraction(finding.toBuilder().setStatus(FactCheckStatus.FACT_CHECK_STATUS_COMPLETED).setSourceRevision(4))
                .addClaims(Claim.newBuilder().setId("c1").setJobId(JOB).setSpeakerLabel("S2").setStartTime(4.0)
                        .setText("台灣大概有三成的人每天聽 Podcast").setClaim("台灣約有 30% 的人每天收聽 Podcast").setKind("number")
                        .setVerdict("supported").setExplanation("調查顯示約三成 [1]").setSourceRevision(4)
                        .addSources(ClaimSource.newBuilder().setTitle("調查").setUrl("https://example.org").setExcerpt("31%")))
                .addClaims(Claim.newBuilder().setId("c2").setJobId(JOB).setStartTime(8.0).setText("法規去年改了")
                        .setClaim("某法規在去年修改").setKind("fact").setChecking(true))
                .build());

        call(MockMvcRequestBuilders.get("/jobs/" + JOB + "/fact-check"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.extraction.status").value("COMPLETED"))
                .andExpect(jsonPath("$.claims[0].verdict").value("supported"))
                .andExpect(jsonPath("$.claims[0].sources[0].url").value("https://example.org"))
                .andExpect(jsonPath("$.claims[0].speakerLabel").value("S2"))
                .andExpect(jsonPath("$.claims[1].verdict").isEmpty())
                .andExpect(jsonPath("$.claims[1].speakerLabel").isEmpty())
                .andExpect(jsonPath("$.claims[1].checking").value(true))
                .andExpect(jsonPath("$.claims[1].checkError").isEmpty());
    }

    @Test
    void aJobNeverCheckedHasNothing() throws Exception {
        when(aiServiceStub.getFactCheck(any())).thenReturn(JobFactCheck.getDefaultInstance());

        call(MockMvcRequestBuilders.get("/jobs/" + JOB + "/fact-check"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.extraction").isEmpty())
                .andExpect(jsonPath("$.claims").isEmpty());
    }

    @Test
    void someoneElsesJobIsNotFound() throws Exception {
        when(uploadServiceStub.getJob(any())).thenThrow(Status.NOT_FOUND.asRuntimeException());

        call(MockMvcRequestBuilders.post("/jobs/" + JOB + "/fact-check")).andExpect(status().isNotFound());
        call(MockMvcRequestBuilders.get("/jobs/" + JOB + "/fact-check")).andExpect(status().isNotFound());
        verify(aiServiceStub, never()).requestFactCheck(any());
        verify(aiServiceStub, never()).getFactCheck(any());
    }

    private ResultActions call(MockHttpServletRequestBuilder request) throws Exception {
        return mvc.perform(request.header("Authorization", "Bearer " + TestAuth.accessToken(jwt, user)));
    }
}
