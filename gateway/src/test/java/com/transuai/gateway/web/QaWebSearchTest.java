package com.transuai.gateway.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.nio.charset.StandardCharsets;
import java.util.List;
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
import com.transuai.upload.grpc.v1.UploadServiceGrpc;

import com.google.protobuf.Timestamp;

import transuai.ai.v1.Ai.AnswerStep;
import transuai.ai.v1.Ai.AskQuestionChunk;
import transuai.ai.v1.Ai.AskQuestionRequest;
import transuai.ai.v1.Ai.CountUserWebSearchesResponse;
import transuai.ai.v1.Ai.ListAvailableModelsResponse;
import transuai.ai.v1.Ai.ListJobLlmUsageResponse;
import transuai.ai.v1.Ai.ListJobWebSearchesResponse;
import transuai.ai.v1.Ai.WebSearchUsage;
import transuai.ai.v1.Ai.ListQaHistoryResponse;
import transuai.ai.v1.Ai.ModelChoice;
import transuai.ai.v1.Ai.QaTurn;
import transuai.ai.v1.Ai.SourceTimestamps;
import transuai.ai.v1.Ai.SumUserLlmUsageResponse;
import transuai.ai.v1.Ai.WebSource;
import transuai.ai.v1.Ai.WebSources;
import transuai.ai.v1.AiServiceGrpc;
import transuai.transcription.v1.Transcription.ListJobTranscriptionUsageResponse;
import transuai.transcription.v1.Transcription.SumUserTranscriptionUsageResponse;
import transuai.transcription.v1.TranscriptionServiceGrpc;

/** 問答查網路（見 .scratch/qa-web-search）：開關傳到 ai-service、網路來源的 SSE 事件、問答紀錄、能不能查網路。 */
@SpringBootTest
@AutoConfigureMockMvc
@Import(RedisContainerConfig.class)
class QaWebSearchTest {

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
        when(aiServiceStub.getDefaultModel(any())).thenReturn(ModelChoice.newBuilder().setProvider("platform").build());
        when(aiServiceStub.sumUserLlmUsage(any())).thenReturn(SumUserLlmUsageResponse.getDefaultInstance());
        when(aiServiceStub.countUserWebSearches(any())).thenReturn(CountUserWebSearchesResponse.getDefaultInstance());
        when(transcriptionServiceStub.sumUserTranscriptionUsage(any()))
                .thenReturn(SumUserTranscriptionUsageResponse.getDefaultInstance());
    }

    @Test
    void aQuestionAskedWithWebSearchRelaysItsWebSourcesAfterTheRecordingSources() throws Exception {
        when(aiServiceStub.askQuestion(any())).thenAnswer(call -> List.of(
                AskQuestionChunk.newBuilder().setSources(SourceTimestamps.newBuilder().addSourceTimestamps(754.0)).build(),
                AskQuestionChunk.newBuilder().setWebSources(WebSources.newBuilder().addSources(
                        WebSource.newBuilder().setTitle("pgvector").setUrl("https://github.com/pgvector/pgvector"))).build(),
                AskQuestionChunk.newBuilder().setAnsweredBy(ModelChoice.newBuilder().setProvider("platform").setModel("m"))
                        .build(),
                AskQuestionChunk.newBuilder().setDelta("是 Postgres 的擴充 [1]。").build()).iterator());

        String stream = streamOf(ask("{\"question\":\"pgvector 是什麼？\",\"webSearch\":true}"));

        assertThat(sentRequest().getWebSearch()).isTrue();
        assertThat(stream).containsSubsequence("event:sources", "event:web_sources", "event:model", "event:delta");
        assertThat(stream).contains(
                "data:{\"sources\":[{\"title\":\"pgvector\",\"url\":\"https://github.com/pgvector/pgvector\"}],\"failed\":false}");
    }

    @Test
    void eachStepOfTheAnswerIsRelayedAsItComes() throws Exception {
        when(aiServiceStub.askQuestion(any())).thenAnswer(call -> List.of(
                AskQuestionChunk.newBuilder().setStep(AnswerStep.newBuilder().setId("retrieve")
                        .setLabel("在內容裡找相關的段落").setState("running")).build(),
                AskQuestionChunk.newBuilder().setStep(AnswerStep.newBuilder().setId("retrieve")
                        .setLabel("在內容裡找相關的段落").setState("done").setDetail("找到 5 段")).build(),
                AskQuestionChunk.newBuilder().setSources(SourceTimestamps.getDefaultInstance()).build()).iterator());

        String stream = streamOf(ask("{\"question\":\"q\"}"));

        assertThat(stream).containsSubsequence("event:step", "event:step", "event:sources");
        assertThat(stream).contains(
                "data:{\"id\":\"retrieve\",\"label\":\"在內容裡找相關的段落\",\"state\":\"done\",\"detail\":\"找到 5 段\"}");
    }

    @Test
    void aFailedSearchIsRelayedAsFailedWithNoSources() throws Exception {
        when(aiServiceStub.askQuestion(any())).thenAnswer(call -> List.of(
                AskQuestionChunk.newBuilder().setSources(SourceTimestamps.getDefaultInstance()).build(),
                AskQuestionChunk.newBuilder().setWebSources(WebSources.newBuilder().setFailed(true)).build()).iterator());

        String stream = streamOf(ask("{\"question\":\"q\",\"webSearch\":true}"));

        assertThat(stream).contains("data:{\"sources\":[],\"failed\":true}");
    }

    @Test
    void aQuestionAskedWithoutSayingSoDoesNotSearchTheWeb() throws Exception {
        when(aiServiceStub.askQuestion(any())).thenAnswer(call -> List.of(
                AskQuestionChunk.newBuilder().setSources(SourceTimestamps.getDefaultInstance()).build()).iterator());

        ask("{\"question\":\"q\"}");  // the request goes out before the stream starts: nothing to wait for

        assertThat(sentRequest().getWebSearch()).isFalse();
    }

    @Test
    void theHistorySaysWhichQuestionsSearchedTheWebAndWhatTheyFound() throws Exception {
        when(aiServiceStub.listQaHistory(any())).thenReturn(ListQaHistoryResponse.newBuilder()
                .addTurns(QaTurn.newBuilder().setQuestion("q1").setAnswer("a1").setWebSearch(true)
                        .addWebSources(WebSource.newBuilder().setTitle("pgvector").setUrl("https://github.com/pgvector/pgvector")))
                .addTurns(QaTurn.newBuilder().setQuestion("q2").setAnswer("a2"))
                .build());

        call(MockMvcRequestBuilders.get("/qa/" + JOB))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].webSearch").value(true))
                .andExpect(jsonPath("$[0].webSources[0].title").value("pgvector"))
                .andExpect(jsonPath("$[0].webSources[0].url").value("https://github.com/pgvector/pgvector"))
                .andExpect(jsonPath("$[1].webSearch").value(false))
                .andExpect(jsonPath("$[1].webSources").isEmpty());
    }

    @Test
    void theModelListSaysWhetherQuestionsCanSearchTheWeb() throws Exception {
        when(aiServiceStub.listAvailableModels(any()))
                .thenReturn(ListAvailableModelsResponse.newBuilder().setWebSearch(true).build());

        call(MockMvcRequestBuilders.get("/ai/models"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.webSearch").value(true));
    }

    @Test
    void aJobsUsageListsEachWebSearchAmongItsCalls() throws Exception {
        when(aiServiceStub.listJobLlmUsage(any())).thenReturn(ListJobLlmUsageResponse.getDefaultInstance());
        when(transcriptionServiceStub.listJobTranscriptionUsage(any()))
                .thenReturn(ListJobTranscriptionUsageResponse.getDefaultInstance());
        when(aiServiceStub.listJobWebSearches(any())).thenReturn(ListJobWebSearchesResponse.newBuilder()
                .addRecords(WebSearchUsage.newBuilder().setProvider("tavily").setSucceeded(true)
                        .setCreatedAt(Timestamp.newBuilder().setSeconds(1_800_000_000)))
                .addRecords(WebSearchUsage.newBuilder().setProvider("tavily").setSucceeded(false)
                        .setCreatedAt(Timestamp.newBuilder().setSeconds(1_800_000_060)))
                .build());

        call(MockMvcRequestBuilders.get("/jobs/" + JOB + "/usage"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.records[0].kind").value("web_search"))
                .andExpect(jsonPath("$.records[0].feature").value("web_search"))
                .andExpect(jsonPath("$.records[0].provider").value("tavily"))
                .andExpect(jsonPath("$.records[0].keySource").value("platform"))
                .andExpect(jsonPath("$.records[0].succeeded").value(true))
                .andExpect(jsonPath("$.records[1].succeeded").value(false))
                .andExpect(jsonPath("$.totals.webSearches").value(1));
    }

    private AskQuestionRequest sentRequest() {
        ArgumentCaptor<AskQuestionRequest> request = ArgumentCaptor.forClass(AskQuestionRequest.class);
        verify(aiServiceStub).askQuestion(request.capture());
        return request.getValue();
    }

    /** The whole SSE stream, once the relay has finished. */
    private String streamOf(ResultActions started) throws Exception {
        MvcResult result = started.andReturn();
        result.getAsyncResult(5_000);  // the emitter itself has no timeout
        return result.getResponse().getContentAsString(StandardCharsets.UTF_8);
    }

    private ResultActions ask(String body) throws Exception {
        return call(MockMvcRequestBuilders.post("/qa/" + JOB).contentType(MediaType.APPLICATION_JSON).content(body));
    }

    private ResultActions call(MockHttpServletRequestBuilder request) throws Exception {
        return mvc.perform(request.header("Authorization", "Bearer " + TestAuth.accessToken(jwt, user)));
    }
}
