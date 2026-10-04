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
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;

import com.transuai.gateway.RedisContainerConfig;
import com.transuai.gateway.TestAuth;
import com.transuai.gateway.security.JwtProperties;
import com.transuai.upload.grpc.v1.Job;
import com.transuai.upload.grpc.v1.ListJobsRequest;
import com.transuai.upload.grpc.v1.ListJobsResponse;
import com.transuai.upload.grpc.v1.UploadServiceGrpc;

import io.grpc.Status;
import transuai.ai.v1.Ai.AskDecisionsChunk;
import transuai.ai.v1.Ai.AskDecisionsRequest;
import transuai.ai.v1.Ai.CreateDecisionRequest;
import transuai.ai.v1.Ai.Decision;
import transuai.ai.v1.Ai.DecisionExtraction;
import transuai.ai.v1.Ai.DecisionExtractionStatus;
import transuai.ai.v1.Ai.DecisionLink;
import transuai.ai.v1.Ai.DeleteDecisionRequest;
import transuai.ai.v1.Ai.DeleteDecisionResponse;
import transuai.ai.v1.Ai.JobDecisions;
import transuai.ai.v1.Ai.ListUserDecisionsRequest;
import transuai.ai.v1.Ai.ModelChoice;
import transuai.ai.v1.Ai.RequestDecisionExtractionRequest;
import transuai.ai.v1.Ai.SearchDecisionsRequest;
import transuai.ai.v1.Ai.UpdateDecisionRequest;
import transuai.ai.v1.Ai.UserDecisions;
import transuai.ai.v1.AiServiceGrpc;

/** 決策紀錄（見 .scratch/decision-log/issues/01、02）：抽取、列出、新增、修改、刪除一個 Job 的決策，先過 ownership；抽取是花錢的功能。 */
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
                .andExpect(jsonPath("$.decisions[1].supersedes").isEmpty());
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
    void addingADecisionPassesTheUserAndWhatTheyWroteOn() throws Exception {
        when(aiServiceStub.createDecision(any())).thenReturn(Decision.newBuilder().setId("d3").setJobId(JOB)
                .setStatement("週會改到週三").setSource("user").setStartTime(12.0).build());

        call(MockMvcRequestBuilders.post("/jobs/" + JOB + "/decisions").contentType(MediaType.APPLICATION_JSON)
                .content("{\"statement\":\"週會改到週三\",\"rationale\":\"週一很忙\",\"alternatives\":[\"週五\"],"
                        + "\"proposedBy\":\"S1\",\"tentative\":true,\"startTime\":12.0}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.id").value("d3"))
                .andExpect(jsonPath("$.source").value("user"));

        ArgumentCaptor<CreateDecisionRequest> sent = ArgumentCaptor.forClass(CreateDecisionRequest.class);
        verify(aiServiceStub).createDecision(sent.capture());
        assertThat(sent.getValue().getUserId()).isEqualTo(user.toString());
        assertThat(sent.getValue().getDecision().getAlternativesList()).containsExactly("週五");
        assertThat(sent.getValue().getDecision().getTentative()).isTrue();
        assertThat(sent.getValue().getStartTime()).isEqualTo(12.0);
    }

    @Test
    void aDecisionWithoutATimeIsAddedWithoutOne() throws Exception {
        when(aiServiceStub.createDecision(any())).thenReturn(Decision.newBuilder().setId("d4").build());

        call(MockMvcRequestBuilders.post("/jobs/" + JOB + "/decisions").contentType(MediaType.APPLICATION_JSON)
                .content("{\"statement\":\"週會改到週三\"}"))
                .andExpect(status().isCreated());

        ArgumentCaptor<CreateDecisionRequest> sent = ArgumentCaptor.forClass(CreateDecisionRequest.class);
        verify(aiServiceStub).createDecision(sent.capture());
        assertThat(sent.getValue().hasStartTime()).isFalse();
        assertThat(sent.getValue().getDecision().getProposedBy()).isEmpty();
    }

    @Test
    void whatTheUserWroteBreakingARuleComesBackAsTheReason() throws Exception {
        when(aiServiceStub.createDecision(any()))
                .thenThrow(Status.INVALID_ARGUMENT.withDescription("決定不能是空的").asRuntimeException());

        call(MockMvcRequestBuilders.post("/jobs/" + JOB + "/decisions").contentType(MediaType.APPLICATION_JSON)
                .content("{\"statement\":\" \"}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    void editingADecisionPassesItsNewContentOn() throws Exception {
        when(aiServiceStub.updateDecision(any())).thenReturn(Decision.newBuilder().setId("d1").setEdited(true).build());

        call(MockMvcRequestBuilders.patch("/jobs/" + JOB + "/decisions/d1").contentType(MediaType.APPLICATION_JSON)
                .content("{\"statement\":\"資料庫確定用 PostgreSQL 16\",\"alternatives\":[]}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.edited").value(true));

        ArgumentCaptor<UpdateDecisionRequest> sent = ArgumentCaptor.forClass(UpdateDecisionRequest.class);
        verify(aiServiceStub).updateDecision(sent.capture());
        assertThat(sent.getValue().getDecisionId()).isEqualTo("d1");
        assertThat(sent.getValue().getDecision().getStatement()).isEqualTo("資料庫確定用 PostgreSQL 16");
    }

    @Test
    void deletingADecisionPassesItOn() throws Exception {
        when(aiServiceStub.deleteDecision(any())).thenReturn(DeleteDecisionResponse.getDefaultInstance());

        call(MockMvcRequestBuilders.delete("/jobs/" + JOB + "/decisions/d1")).andExpect(status().isNoContent());

        verify(aiServiceStub).deleteDecision(DeleteDecisionRequest.newBuilder().setJobId(JOB).setDecisionId("d1").build());
    }

    @Test
    void aDecisionOfAnotherJobIsNotFound() throws Exception {
        when(aiServiceStub.deleteDecision(any())).thenThrow(Status.NOT_FOUND.asRuntimeException());

        call(MockMvcRequestBuilders.delete("/jobs/" + JOB + "/decisions/d9")).andExpect(status().isNotFound());
    }

    private static Job job(String id, String title, String createdAt) {
        java.time.Instant at = java.time.Instant.parse(createdAt);
        return Job.newBuilder().setJobId(id).setTitle(title).setFileName(id + ".mp3").setCategory("meeting")
                .setCreatedAt(com.google.protobuf.Timestamp.newBuilder().setSeconds(at.getEpochSecond())).build();
    }

    private static Decision decision(String id, String jobId, String statement) {
        return Decision.newBuilder().setId(id).setJobId(jobId).setStatement(statement).setSource("ai").build();
    }

    @Test
    void theTimelineHasTheNewestMeetingFirstWithItsDecisionsInOrder() throws Exception {
        when(uploadServiceStub.listJobs(any())).thenReturn(ListJobsResponse.newBuilder()
                .addJobs(job("job-old", "九月週會", "2026-09-01T00:00:00Z"))
                .addJobs(job("job-new", "十月週會", "2026-10-01T00:00:00Z")).setTotalCount(2).build());
        when(aiServiceStub.listUserDecisions(any())).thenReturn(UserDecisions.newBuilder()
                .addDecisions(decision("a1", "job-old", "資料庫用 MySQL"))
                .addDecisions(decision("b1", "job-new", "資料庫改用 PostgreSQL"))
                .addDecisions(decision("a2", "job-old", "週會改到週三")).build());

        call(MockMvcRequestBuilders.get("/decisions"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].decision.id").value("b1"))
                .andExpect(jsonPath("$.items[0].job.title").value("十月週會"))
                .andExpect(jsonPath("$.items[1].decision.id").value("a1"))
                .andExpect(jsonPath("$.items[2].decision.id").value("a2"))
                .andExpect(jsonPath("$.items[2].job.jobId").value("job-old"))
                .andExpect(jsonPath("$.items[2].job.category").value("meeting"));

        ArgumentCaptor<ListUserDecisionsRequest> sent = ArgumentCaptor.forClass(ListUserDecisionsRequest.class);
        verify(aiServiceStub).listUserDecisions(sent.capture());
        assertThat(sent.getValue().getUserId()).isEqualTo(user.toString());
        assertThat(sent.getValue().getJobIdsList()).containsExactlyInAnyOrder("job-old", "job-new");
    }

    @Test
    void theTimelineOnlyAsksAboutTheUsersOwnJobsOfTheChosenCategory() throws Exception {
        when(uploadServiceStub.listJobs(any())).thenReturn(ListJobsResponse.newBuilder()
                .addJobs(job("job-old", "九月週會", "2026-09-01T00:00:00Z")).setTotalCount(1).build());
        when(aiServiceStub.listUserDecisions(any())).thenReturn(UserDecisions.getDefaultInstance());

        call(MockMvcRequestBuilders.get("/decisions").param("category", "meeting")).andExpect(status().isOk());

        ArgumentCaptor<ListJobsRequest> jobs = ArgumentCaptor.forClass(ListJobsRequest.class);
        verify(uploadServiceStub).listJobs(jobs.capture());
        assertThat(jobs.getValue().getCategory()).isEqualTo("meeting");
    }

    @Test
    void theTimelineOfOneJobAsksAboutThatJobOnly() throws Exception {
        when(uploadServiceStub.listJobs(any())).thenReturn(ListJobsResponse.newBuilder()
                .addJobs(job("job-old", "九月週會", "2026-09-01T00:00:00Z"))
                .addJobs(job("job-new", "十月週會", "2026-10-01T00:00:00Z")).setTotalCount(2).build());
        when(aiServiceStub.listUserDecisions(any())).thenReturn(UserDecisions.getDefaultInstance());

        call(MockMvcRequestBuilders.get("/decisions").param("jobId", "job-new")).andExpect(status().isOk());

        ArgumentCaptor<ListUserDecisionsRequest> sent = ArgumentCaptor.forClass(ListUserDecisionsRequest.class);
        verify(aiServiceStub).listUserDecisions(sent.capture());
        assertThat(sent.getValue().getJobIdsList()).containsExactly("job-new");
    }

    @Test
    void searchingKeepsTheOrderOfHowWellTheyMatch() throws Exception {
        when(uploadServiceStub.listJobs(any())).thenReturn(ListJobsResponse.newBuilder()
                .addJobs(job("job-old", "九月週會", "2026-09-01T00:00:00Z"))
                .addJobs(job("job-new", "十月週會", "2026-10-01T00:00:00Z")).setTotalCount(2).build());
        when(aiServiceStub.searchDecisions(any())).thenReturn(UserDecisions.newBuilder()
                .addDecisions(decision("a1", "job-old", "資料庫用 MySQL"))
                .addDecisions(decision("b1", "job-new", "資料庫改用 PostgreSQL")).build());

        call(MockMvcRequestBuilders.get("/decisions").param("q", "資料庫"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].decision.id").value("a1"))
                .andExpect(jsonPath("$.items[1].decision.id").value("b1"));

        ArgumentCaptor<SearchDecisionsRequest> sent = ArgumentCaptor.forClass(SearchDecisionsRequest.class);
        verify(aiServiceStub).searchDecisions(sent.capture());
        assertThat(sent.getValue().getQuery()).isEqualTo("資料庫");
        assertThat(sent.getValue().getUserId()).isEqualTo(user.toString());
    }

    @Test
    void allOfTheUsersJobsAreLookedAtPageByPage() throws Exception {
        ListJobsResponse.Builder first = ListJobsResponse.newBuilder().setTotalCount(101);
        for (int i = 0; i < 100; i++) {
            first.addJobs(job("job-" + i, "週會 " + i, "2026-09-01T00:00:00Z"));
        }
        when(uploadServiceStub.listJobs(any())).thenReturn(first.build(), ListJobsResponse.newBuilder()
                .addJobs(job("job-100", "最後一場", "2026-10-01T00:00:00Z")).setTotalCount(101).build());
        when(aiServiceStub.listUserDecisions(any())).thenReturn(UserDecisions.getDefaultInstance());

        call(MockMvcRequestBuilders.get("/decisions")).andExpect(status().isOk());

        ArgumentCaptor<ListUserDecisionsRequest> sent = ArgumentCaptor.forClass(ListUserDecisionsRequest.class);
        verify(aiServiceStub).listUserDecisions(sent.capture());
        assertThat(sent.getValue().getJobIdsList()).hasSize(101);
    }

    @Test
    void withoutJobsNothingIsAsked() throws Exception {
        when(uploadServiceStub.listJobs(any())).thenReturn(ListJobsResponse.getDefaultInstance());

        call(MockMvcRequestBuilders.get("/decisions")).andExpect(status().isOk()).andExpect(jsonPath("$.items").isEmpty());

        verify(aiServiceStub, never()).listUserDecisions(any());
    }

    @Test
    void extractingTellsWhenTheMeetingWasSoEarlierDecisionsCanBeFound() throws Exception {
        when(uploadServiceStub.getJob(any())).thenReturn(job(JOB, "十月週會", "2026-10-01T00:00:00Z"));
        when(aiServiceStub.requestDecisionExtraction(any())).thenReturn(extracting);

        call(MockMvcRequestBuilders.post("/jobs/" + JOB + "/decisions/extract")).andExpect(status().isAccepted());

        ArgumentCaptor<RequestDecisionExtractionRequest> sent = ArgumentCaptor.forClass(RequestDecisionExtractionRequest.class);
        verify(aiServiceStub).requestDecisionExtraction(sent.capture());
        assertThat(sent.getValue().getMeetingAt().getSeconds())
                .isEqualTo(java.time.Instant.parse("2026-10-01T00:00:00Z").getEpochSecond());
    }

    @Test
    void aDecisionComesWithWhatItSupersededAndWhatSupersededIt() throws Exception {
        com.google.protobuf.Timestamp september = com.google.protobuf.Timestamp.newBuilder()
                .setSeconds(java.time.Instant.parse("2026-09-01T00:00:00Z").getEpochSecond()).build();
        when(aiServiceStub.getJobDecisions(any())).thenReturn(JobDecisions.newBuilder()
                .addDecisions(Decision.newBuilder().setId("d1").setJobId(JOB).setStatement("資料庫改用 PostgreSQL")
                        .setSupersedes(DecisionLink.newBuilder().setId("old").setJobId("job-sep").setStatement("資料庫用 MySQL")
                                .setMeetingAt(september))
                        .addSupersededBy(DecisionLink.newBuilder().setId("newer").setJobId("job-nov").setStatement("改回 MySQL")))
                .addDecisions(Decision.newBuilder().setId("d2").setJobId(JOB).setStatement("週會改到週三"))
                .build());

        call(MockMvcRequestBuilders.get("/jobs/" + JOB + "/decisions"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.decisions[0].supersedes.id").value("old"))
                .andExpect(jsonPath("$.decisions[0].supersedes.jobId").value("job-sep"))
                .andExpect(jsonPath("$.decisions[0].supersedes.statement").value("資料庫用 MySQL"))
                .andExpect(jsonPath("$.decisions[0].supersedes.meetingAt").value("2026-09-01T00:00:00Z"))
                .andExpect(jsonPath("$.decisions[0].supersededBy[0].id").value("newer"))
                .andExpect(jsonPath("$.decisions[0].supersededBy[0].meetingAt").isEmpty())
                .andExpect(jsonPath("$.decisions[1].supersedes").isEmpty())
                .andExpect(jsonPath("$.decisions[1].supersededBy").isEmpty());
    }

    @Test
    void askingStreamsTheAnswerWithTheDecisionsItIsBasedOnAndTheirMeetings() throws Exception {
        when(uploadServiceStub.listJobs(any())).thenReturn(ListJobsResponse.newBuilder()
                .addJobs(job("job-old", "九月週會", "2026-09-01T00:00:00Z")).setTotalCount(1).build());
        when(aiServiceStub.askDecisions(any())).thenReturn(java.util.List.of(
                AskDecisionsChunk.newBuilder().setSources(UserDecisions.newBuilder()
                        .addDecisions(decision("a1", "job-old", "資料庫用 MySQL"))).build(),
                AskDecisionsChunk.newBuilder().setAnsweredBy(ModelChoice.newBuilder().setProvider("platform").setModel("qwen3:14b")).build(),
                AskDecisionsChunk.newBuilder().setDelta("當初選 MySQL 是因為團隊熟 [1]。").build()).iterator());

        MvcResult result = call(MockMvcRequestBuilders.post("/decisions/ask").contentType(MediaType.APPLICATION_JSON)
                .content("{\"question\":\"當初為什麼選 MySQL？\",\"category\":\"meeting\"}")).andReturn();
        result.getAsyncResult(5_000);
        String stream = result.getResponse().getContentAsString(java.nio.charset.StandardCharsets.UTF_8);

        assertThat(stream).containsSubsequence("event:sources", "event:model", "event:delta");
        assertThat(stream).contains("\"job\":{\"jobId\":\"job-old\",\"title\":\"九月週會\"");
        assertThat(stream).contains("\"createdAt\":\"2026-09-01T00:00:00Z\"");
        assertThat(stream).contains("data:\"當初選 MySQL 是因為團隊熟 [1]。\"");
        ArgumentCaptor<AskDecisionsRequest> sent = ArgumentCaptor.forClass(AskDecisionsRequest.class);
        verify(aiServiceStub).askDecisions(sent.capture());
        assertThat(sent.getValue().getUserId()).isEqualTo(user.toString());
        assertThat(sent.getValue().getQuestion()).isEqualTo("當初為什麼選 MySQL？");
        assertThat(sent.getValue().getJobIdsList()).containsExactly("job-old");
    }

    @Test
    void aQuestionIsRequired() throws Exception {
        call(MockMvcRequestBuilders.post("/decisions/ask").contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isBadRequest());
        verify(aiServiceStub, never()).askDecisions(any());
    }

    @Test
    void someoneElsesJobIsNotFound() throws Exception {
        when(uploadServiceStub.getJob(any())).thenThrow(Status.NOT_FOUND.asRuntimeException());

        call(MockMvcRequestBuilders.post("/jobs/" + JOB + "/decisions/extract")).andExpect(status().isNotFound());
        call(MockMvcRequestBuilders.get("/jobs/" + JOB + "/decisions")).andExpect(status().isNotFound());
        verify(aiServiceStub, never()).requestDecisionExtraction(any());
        verify(aiServiceStub, never()).getJobDecisions(any());
        call(MockMvcRequestBuilders.delete("/jobs/" + JOB + "/decisions/d1")).andExpect(status().isNotFound());
        verify(aiServiceStub, never()).deleteDecision(any());
    }

    private ResultActions call(MockHttpServletRequestBuilder request) throws Exception {
        return mvc.perform(request.header("Authorization", "Bearer " + TestAuth.accessToken(jwt, user)));
    }
}
