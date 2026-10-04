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
import transuai.ai.v1.Ai.Decision;
import transuai.ai.v1.Ai.DecisionExtraction;
import transuai.ai.v1.Ai.DecisionExtractionStatus;
import transuai.ai.v1.Ai.JobDecisions;
import transuai.ai.v1.Ai.ModelChoice;
import transuai.ai.v1.Ai.RequestDecisionExtractionRequest;
import transuai.ai.v1.AiServiceGrpc;

/** 決策紀錄（見 .scratch/decision-log/issues/01）：抽取與列出一個 Job 的決策，先過 ownership；抽取是花錢的功能。 */
@SpringBootTest
@AutoConfigureMockMvc
@Import(RedisContainerConfig.class)
class DecisionTest {

    private static final String JOB = "55555555-5555-5555-5555-555555555555";

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

    private final DecisionExtraction extracting = DecisionExtraction.newBuilder().setJobId(JOB)
            .setStatus(DecisionExtractionStatus.DECISION_EXTRACTION_STATUS_GENERATING).build();

    @BeforeEach
    void setUp() {
        redis.getConnectionFactory().getConnection().serverCommands().flushAll();
        when(uploadServiceStub.withInterceptors(any())).thenReturn(uploadServiceStub);
        when(uploadServiceStub.getJob(any())).thenReturn(Job.getDefaultInstance());
        when(aiServiceStub.getDefaultModel(any())).thenReturn(ModelChoice.newBuilder().setProvider("openai").build());
    }

    @Test
    void extractingPassesTheUserOn() throws Exception {
        when(aiServiceStub.requestDecisionExtraction(any())).thenReturn(extracting);

        call(MockMvcRequestBuilders.post("/jobs/" + JOB + "/decisions/extract"))
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.status").value("GENERATING"));

        ArgumentCaptor<RequestDecisionExtractionRequest> sent = ArgumentCaptor.forClass(RequestDecisionExtractionRequest.class);
        verify(aiServiceStub).requestDecisionExtraction(sent.capture());
        assertThat(sent.getValue().getUserId()).isEqualTo(user.toString());
        assertThat(sent.getValue().getJobId()).isEqualTo(JOB);
    }

    @Test
    void theJobsDecisionsComeWithTheExtraction() throws Exception {
        when(aiServiceStub.getJobDecisions(any())).thenReturn(JobDecisions.newBuilder()
                .setExtraction(extracting.toBuilder().setStatus(DecisionExtractionStatus.DECISION_EXTRACTION_STATUS_COMPLETED)
                        .setSourceRevision(3))
                .addDecisions(Decision.newBuilder().setId("d1").setJobId(JOB).setStatement("資料庫用 PostgreSQL")
                        .setRationale("需要 pgvector").addAlternatives("MySQL").setProposedBy("S1").setStartTime(8.0)
                        .setEvidenceText("好 那就決定用 PostgreSQL").setSource("ai"))
                .addDecisions(Decision.newBuilder().setId("d2").setJobId(JOB).setStatement("週會改到週三").setSource("user")
                        .setTentative(true))
                .build());

        call(MockMvcRequestBuilders.get("/jobs/" + JOB + "/decisions"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.extraction.status").value("COMPLETED"))
                .andExpect(jsonPath("$.extraction.sourceRevision").value(3))
                .andExpect(jsonPath("$.decisions[0].statement").value("資料庫用 PostgreSQL"))
                .andExpect(jsonPath("$.decisions[0].alternatives[0]").value("MySQL"))
                .andExpect(jsonPath("$.decisions[0].proposedBy").value("S1"))
                .andExpect(jsonPath("$.decisions[0].startTime").value(8.0))
                .andExpect(jsonPath("$.decisions[1].startTime").isEmpty())
                .andExpect(jsonPath("$.decisions[1].proposedBy").isEmpty())
                .andExpect(jsonPath("$.decisions[1].tentative").value(true))
                .andExpect(jsonPath("$.decisions[1].supersedesId").isEmpty());
    }

    @Test
    void aJobNeverExtractedHasNoExtraction() throws Exception {
        when(aiServiceStub.getJobDecisions(any())).thenReturn(JobDecisions.getDefaultInstance());

        call(MockMvcRequestBuilders.get("/jobs/" + JOB + "/decisions"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.extraction").isEmpty())
                .andExpect(jsonPath("$.decisions").isEmpty());
    }

    @Test
    void someoneElsesJobIsNotFound() throws Exception {
        when(uploadServiceStub.getJob(any())).thenThrow(Status.NOT_FOUND.asRuntimeException());

        call(MockMvcRequestBuilders.post("/jobs/" + JOB + "/decisions/extract")).andExpect(status().isNotFound());
        call(MockMvcRequestBuilders.get("/jobs/" + JOB + "/decisions")).andExpect(status().isNotFound());
        verify(aiServiceStub, never()).requestDecisionExtraction(any());
        verify(aiServiceStub, never()).getJobDecisions(any());
    }

    private ResultActions call(MockHttpServletRequestBuilder request) throws Exception {
        return mvc.perform(request.header("Authorization", "Bearer " + TestAuth.accessToken(jwt, user)));
    }
}
