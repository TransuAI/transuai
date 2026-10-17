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
import transuai.ai.v1.Ai.ListSpeakerSuggestionsResponse;
import transuai.ai.v1.Ai.SetSpeakerSuggestionStatusRequest;
import transuai.ai.v1.Ai.SpeakerSuggestion;
import transuai.ai.v1.AiServiceGrpc;

/** 講者名字建議（見 .scratch/speaker-name-suggestions）：列出與改狀態，先過 ownership。 */
@SpringBootTest
@AutoConfigureMockMvc
@Import(RedisContainerConfig.class)
class SpeakerSuggestionsTest {

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

    private final UUID user = UUID.randomUUID();

    private final SpeakerSuggestion eric = SpeakerSuggestion.newBuilder().setSpeakerLabel("S1").setName("Eric Johnson")
            .setEvidenceStartTime(2.5).setEvidenceText("This is Eric Johnson.").setStatus("pending").build();

    @BeforeEach
    void setUp() {
        redis.getConnectionFactory().getConnection().serverCommands().flushAll();
        when(uploadServiceStub.withInterceptors(any())).thenReturn(uploadServiceStub);
        when(uploadServiceStub.getJob(any())).thenReturn(Job.getDefaultInstance());
    }

    @Test
    void theJobsSuggestionsAreListed() throws Exception {
        when(aiServiceStub.listSpeakerSuggestions(any()))
                .thenReturn(ListSpeakerSuggestionsResponse.newBuilder().addSuggestions(eric).build());

        call(MockMvcRequestBuilders.get("/jobs/" + JOB + "/speaker-suggestions"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].speakerLabel").value("S1"))
                .andExpect(jsonPath("$[0].name").value("Eric Johnson"))
                .andExpect(jsonPath("$[0].evidenceStartTime").value(2.5))
                .andExpect(jsonPath("$[0].evidenceText").value("This is Eric Johnson."))
                .andExpect(jsonPath("$[0].status").value("pending"));
    }

    @Test
    void aSuggestionIsMarkedAppliedOrDismissed() throws Exception {
        when(aiServiceStub.setSpeakerSuggestionStatus(any())).thenReturn(eric.toBuilder().setStatus("dismissed").build());

        call(MockMvcRequestBuilders.put("/jobs/" + JOB + "/speaker-suggestions/S1")
                .contentType(MediaType.APPLICATION_JSON).content("{\"status\":\"dismissed\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("dismissed"));

        ArgumentCaptor<SetSpeakerSuggestionStatusRequest> sent = ArgumentCaptor.forClass(SetSpeakerSuggestionStatusRequest.class);
        verify(aiServiceStub).setSpeakerSuggestionStatus(sent.capture());
        assertThat(sent.getValue().getJobId()).isEqualTo(JOB);
        assertThat(sent.getValue().getSpeakerLabel()).isEqualTo("S1");
        assertThat(sent.getValue().getStatus()).isEqualTo("dismissed");
    }

    @Test
    void someoneElsesJobIsNotFound() throws Exception {
        when(uploadServiceStub.getJob(any())).thenThrow(Status.NOT_FOUND.asRuntimeException());

        call(MockMvcRequestBuilders.get("/jobs/" + JOB + "/speaker-suggestions")).andExpect(status().isNotFound());
        verify(aiServiceStub, never()).listSpeakerSuggestions(any());
    }

    private ResultActions call(MockHttpServletRequestBuilder request) throws Exception {
        return mvc.perform(request.header("Authorization", "Bearer " + TestAuth.accessToken(jwt, user)));
    }
}
