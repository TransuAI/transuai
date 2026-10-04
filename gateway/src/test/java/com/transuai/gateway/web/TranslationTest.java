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
import transuai.ai.v1.Ai.DeleteTranslationRequest;
import transuai.ai.v1.Ai.DeleteTranslationResponse;
import transuai.ai.v1.Ai.ListTranslationsResponse;
import transuai.ai.v1.Ai.ModelChoice;
import transuai.ai.v1.Ai.RequestTranslationRequest;
import transuai.ai.v1.Ai.SegmentTranslation;
import transuai.ai.v1.Ai.Translation;
import transuai.ai.v1.Ai.TranslationStatus;
import transuai.ai.v1.AiServiceGrpc;

/** 譯文（見 .scratch/transcript-translation/issues/01、03）：要求、列出、取得、刪除，先過 ownership；要求是花錢的功能。 */
@SpringBootTest
@AutoConfigureMockMvc
@Import(RedisContainerConfig.class)
class TranslationTest {

    private static final String JOB = "44444444-4444-4444-4444-444444444444";

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

    private final Translation translating = Translation.newBuilder().setJobId(JOB).setLanguage("zh-TW")
            .setStatus(TranslationStatus.TRANSLATION_STATUS_GENERATING).setTotalSegments(10).setTranslatedSegments(4).build();

    @BeforeEach
    void setUp() {
        redis.getConnectionFactory().getConnection().serverCommands().flushAll();
        when(uploadServiceStub.withInterceptors(any())).thenReturn(uploadServiceStub);
        when(uploadServiceStub.getJob(any())).thenReturn(Job.getDefaultInstance());
        when(aiServiceStub.getDefaultModel(any())).thenReturn(ModelChoice.newBuilder().setProvider("openai").build());
    }

    @Test
    void askingForATranslationPassesTheUserAndLanguageOn() throws Exception {
        when(aiServiceStub.requestTranslation(any())).thenReturn(translating);

        post("{\"language\":\"zh-TW\"}")
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.status").value("GENERATING"))
                .andExpect(jsonPath("$.translatedSegments").value(4))
                .andExpect(jsonPath("$.segments").doesNotExist());

        ArgumentCaptor<RequestTranslationRequest> sent = ArgumentCaptor.forClass(RequestTranslationRequest.class);
        verify(aiServiceStub).requestTranslation(sent.capture());
        assertThat(sent.getValue().getUserId()).isEqualTo(user.toString());
        assertThat(sent.getValue().getLanguage()).isEqualTo("zh-TW");
    }

    @Test
    void eachLanguageIsListedWithItsProgress() throws Exception {
        when(aiServiceStub.listTranslations(any())).thenReturn(ListTranslationsResponse.newBuilder().addTranslations(translating).build());

        call(MockMvcRequestBuilders.get("/jobs/" + JOB + "/translations"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].language").value("zh-TW"))
                .andExpect(jsonPath("$[0].totalSegments").value(10));
    }

    @Test
    void oneLanguageComesWithItsSegments() throws Exception {
        when(aiServiceStub.getTranslation(any())).thenReturn(translating.toBuilder()
                .addSegments(SegmentTranslation.newBuilder().setSegmentId("s1").setText("嗨。")).build());

        call(MockMvcRequestBuilders.get("/jobs/" + JOB + "/translations/zh-TW"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.segments[0].segmentId").value("s1"))
                .andExpect(jsonPath("$.segments[0].text").value("嗨。"));
    }

    @Test
    void deletingALanguagePassesItOn() throws Exception {
        when(aiServiceStub.deleteTranslation(any())).thenReturn(DeleteTranslationResponse.getDefaultInstance());

        call(MockMvcRequestBuilders.delete("/jobs/" + JOB + "/translations/ja")).andExpect(status().isNoContent());

        verify(aiServiceStub).deleteTranslation(DeleteTranslationRequest.newBuilder().setJobId(JOB).setLanguage("ja").build());
    }

    @Test
    void deletingALanguageThatWasNeverTranslatedIsNotFound() throws Exception {
        when(aiServiceStub.deleteTranslation(any())).thenThrow(Status.NOT_FOUND.asRuntimeException());

        call(MockMvcRequestBuilders.delete("/jobs/" + JOB + "/translations/ko")).andExpect(status().isNotFound());
    }

    @Test
    void someoneElsesTranslationCannotBeDeleted() throws Exception {
        when(uploadServiceStub.getJob(any())).thenThrow(Status.NOT_FOUND.asRuntimeException());

        call(MockMvcRequestBuilders.delete("/jobs/" + JOB + "/translations/ja")).andExpect(status().isNotFound());
        verify(aiServiceStub, never()).deleteTranslation(any());
    }

    @Test
    void aLanguageIsRequired() throws Exception {
        post("{}").andExpect(status().isBadRequest());
        verify(aiServiceStub, never()).requestTranslation(any());
    }

    @Test
    void someoneElsesJobIsNotFound() throws Exception {
        when(uploadServiceStub.getJob(any())).thenThrow(Status.NOT_FOUND.asRuntimeException());

        post("{\"language\":\"en\"}").andExpect(status().isNotFound());
        verify(aiServiceStub, never()).requestTranslation(any());
    }

    private ResultActions post(String body) throws Exception {
        return call(MockMvcRequestBuilders.post("/jobs/" + JOB + "/translations").contentType(MediaType.APPLICATION_JSON).content(body));
    }

    private ResultActions call(MockHttpServletRequestBuilder request) throws Exception {
        return mvc.perform(request.header("Authorization", "Bearer " + TestAuth.accessToken(jwt, user)));
    }
}
