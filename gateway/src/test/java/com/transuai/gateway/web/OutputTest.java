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
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;

import com.transuai.gateway.RedisContainerConfig;
import com.transuai.gateway.TestAuth;
import com.transuai.gateway.security.JwtProperties;
import com.transuai.upload.grpc.v1.Job;
import com.transuai.upload.grpc.v1.UploadServiceGrpc;

import io.grpc.Status;
import transuai.ai.v1.Ai.GeneratedOutput;
import transuai.ai.v1.Ai.ListOutputsResponse;
import transuai.ai.v1.Ai.ModelChoice;
import transuai.ai.v1.Ai.OutputStatus;
import transuai.ai.v1.Ai.RequestOutputRequest;
import transuai.ai.v1.Ai.UpdateOutputRequest;
import transuai.ai.v1.AiServiceGrpc;

/** 多格式輸出（見 .scratch/multi-format-outputs/issues/01）：要求、列出、取得，先過 ownership；要求是花錢的功能、帶上 Job 的標題。 */
@SpringBootTest
@AutoConfigureMockMvc
@Import(RedisContainerConfig.class)
class OutputTest {

    private static final String JOB = "33333333-3333-3333-3333-333333333333";

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

    private final GeneratedOutput done = GeneratedOutput.newBuilder().setId("o1").setJobId(JOB).setFormat("podcast_description")
            .setStatus(OutputStatus.OUTPUT_STATUS_COMPLETED).setContent("介紹\n").setSourceRevision(2).setModel("qwen").build();

    @BeforeEach
    void setUp() {
        redis.getConnectionFactory().getConnection().serverCommands().flushAll();
        when(uploadServiceStub.withInterceptors(any())).thenReturn(uploadServiceStub);
        when(uploadServiceStub.getJob(any())).thenReturn(Job.newBuilder().setTitle("產品週會").build());
        when(aiServiceStub.getDefaultModel(any())).thenReturn(ModelChoice.newBuilder().setProvider("openai").build());
    }

    @Test
    void askingForAnOutputPassesTheUserTheJobsTitleAndTheRequestOn() throws Exception {
        when(aiServiceStub.requestOutput(any())).thenReturn(done.toBuilder()
                .setStatus(OutputStatus.OUTPUT_STATUS_GENERATING).clearContent().build());

        post("{\"format\":\"podcast_description\",\"instruction\":\"輕鬆一點\"}")
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.status").value("GENERATING"))
                .andExpect(jsonPath("$.content").doesNotExist());

        ArgumentCaptor<RequestOutputRequest> sent = ArgumentCaptor.forClass(RequestOutputRequest.class);
        verify(aiServiceStub).requestOutput(sent.capture());
        assertThat(sent.getValue().getUserId()).isEqualTo(user.toString());
        assertThat(sent.getValue().getTitle()).isEqualTo("產品週會");
        assertThat(sent.getValue().getFormat()).isEqualTo("podcast_description");
        assertThat(sent.getValue().getInstruction()).isEqualTo("輕鬆一點");
    }

    @Test
    void aSocialPostsPlatformIsPassedOnAndReturned() throws Exception {
        when(aiServiceStub.requestOutput(any())).thenReturn(done.toBuilder().setFormat("social_post").setPlatform("threads").build());

        post("{\"format\":\"social_post\",\"platform\":\"threads\"}")
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.platform").value("threads"));

        ArgumentCaptor<RequestOutputRequest> sent = ArgumentCaptor.forClass(RequestOutputRequest.class);
        verify(aiServiceStub).requestOutput(sent.capture());
        assertThat(sent.getValue().getPlatform()).isEqualTo("threads");
    }

    @Test
    void theOutputsAreListedWithTheirContent() throws Exception {
        when(aiServiceStub.listOutputs(any())).thenReturn(ListOutputsResponse.newBuilder().addOutputs(done).build());

        call(MockMvcRequestBuilders.get("/jobs/" + JOB + "/outputs"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].format").value("podcast_description"))
                .andExpect(jsonPath("$[0].status").value("COMPLETED"))
                .andExpect(jsonPath("$[0].content").value("介紹\n"))
                .andExpect(jsonPath("$[0].editedAt").doesNotExist());
    }

    @Test
    void theContentCanBeChanged() throws Exception {
        when(aiServiceStub.updateOutput(any())).thenReturn(done.toBuilder().setContent("改過的\n")
                .setEditedAt(com.google.protobuf.Timestamp.newBuilder().setSeconds(1_790_000_000)).build());

        call(MockMvcRequestBuilders.patch("/jobs/" + JOB + "/outputs/o1").contentType(MediaType.APPLICATION_JSON)
                .content("{\"content\":\"改過的\\n\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content").value("改過的\n"))
                .andExpect(jsonPath("$.editedAt").exists());

        ArgumentCaptor<UpdateOutputRequest> sent = ArgumentCaptor.forClass(UpdateOutputRequest.class);
        verify(aiServiceStub).updateOutput(sent.capture());
        assertThat(sent.getValue().getOutputId()).isEqualTo("o1");
        assertThat(sent.getValue().getContent()).isEqualTo("改過的\n");
    }

    @Test
    void changingAnOutputStillBeingGeneratedIsAConflict() throws Exception {
        when(aiServiceStub.updateOutput(any())).thenThrow(Status.FAILED_PRECONDITION.asRuntimeException());

        call(MockMvcRequestBuilders.patch("/jobs/" + JOB + "/outputs/o1").contentType(MediaType.APPLICATION_JSON)
                .content("{\"content\":\"太早\"}"))
                .andExpect(status().isConflict());
    }

    @Test
    void aFormatIsRequired() throws Exception {
        post("{}").andExpect(status().isBadRequest());
        verify(aiServiceStub, never()).requestOutput(any());
    }

    @Test
    void askingTooOftenIsRateLimited() throws Exception {
        when(aiServiceStub.requestOutput(any())).thenReturn(done);

        for (int i = 0; i < 20; i++) {
            post("{\"format\":\"podcast_description\"}").andExpect(status().isAccepted());
        }
        post("{\"format\":\"podcast_description\"}").andExpect(status().isTooManyRequests());
    }

    @Test
    void someoneElsesJobIsNotFound() throws Exception {
        when(uploadServiceStub.getJob(any())).thenThrow(Status.NOT_FOUND.asRuntimeException());

        post("{\"format\":\"podcast_description\"}").andExpect(status().isNotFound());
        verify(aiServiceStub, never()).requestOutput(any());
    }

    private ResultActions post(String body) throws Exception {
        return call(MockMvcRequestBuilders.post("/jobs/" + JOB + "/outputs").contentType(MediaType.APPLICATION_JSON).content(body));
    }

    private ResultActions call(MockHttpServletRequestBuilder request) throws Exception {
        return mvc.perform(request.header("Authorization", "Bearer " + TestAuth.accessToken(jwt, user)));
    }
}
