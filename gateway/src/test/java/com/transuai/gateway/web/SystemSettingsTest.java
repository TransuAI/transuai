package com.transuai.gateway.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
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
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import com.transuai.auth.grpc.v1.AuthServiceGrpc;
import com.transuai.auth.grpc.v1.SystemStatus;
import com.transuai.auth.grpc.v1.User;
import com.transuai.gateway.RedisContainerConfig;
import com.transuai.gateway.TestAuth;
import com.transuai.gateway.security.JwtProperties;

import transuai.ai.v1.Ai.AiSettings;
import transuai.ai.v1.Ai.UpdateAiSettingsRequest;
import transuai.ai.v1.AiServiceGrpc;
import transuai.transcription.v1.Transcription.SpeechSettings;
import transuai.transcription.v1.TranscriptionServiceGrpc;

/** 系統設定（.scratch/system-settings/issues/06）：/admin/** 只給管理員，/system/status 不用登入，金鑰沒給是不改、空字串是清掉。 */
@SpringBootTest
@AutoConfigureMockMvc
@Import(RedisContainerConfig.class)
class SystemSettingsTest {

    @Autowired
    private MockMvc mvc;

    @Autowired
    private JwtProperties jwt;

    @MockitoBean
    private AuthServiceGrpc.AuthServiceBlockingStub authServiceStub;

    @MockitoBean
    private AiServiceGrpc.AiServiceBlockingStub aiServiceStub;

    @MockitoBean
    private TranscriptionServiceGrpc.TranscriptionServiceBlockingStub transcriptionServiceStub;

    private String token;

    @BeforeEach
    void setUp() {
        token = TestAuth.accessToken(jwt, UUID.randomUUID());
        when(authServiceStub.withInterceptors(any())).thenReturn(authServiceStub);
        when(aiServiceStub.getAiSettings(any())).thenReturn(AiSettings.newBuilder().setPlatformModel("Qwen/Qwen3-8B-AWQ")
                .setPlatformApiKeySet(true).build());
        when(aiServiceStub.updateAiSettings(any())).thenReturn(AiSettings.getDefaultInstance());
    }

    private void signedInAs(boolean admin) {
        when(authServiceStub.getMe(any())).thenReturn(User.newBuilder().setIsAdmin(admin).build());
    }

    @Test
    void theSystemStatusNeedsNoSignIn() throws Exception {
        when(authServiceStub.getSystemStatus(any())).thenReturn(SystemStatus.newBuilder().setSetupRequired(true).build());

        mvc.perform(get("/system/status"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.setupRequired").value(true))
                .andExpect(jsonPath("$.mailEnabled").value(false));
    }

    @Test
    void aMemberCannotSeeOrChangeTheSettings() throws Exception {
        signedInAs(false);

        mvc.perform(get("/admin/settings/ai").header(HttpHeaders.AUTHORIZATION, "Bearer " + token))
                .andExpect(status().isForbidden());
        mvc.perform(put("/admin/settings/ai").header(HttpHeaders.AUTHORIZATION, "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON).content("{\"platformModel\":\"x\"}"))
                .andExpect(status().isForbidden());
        verify(aiServiceStub, never()).getAiSettings(any());
        verify(aiServiceStub, never()).updateAiSettings(any());
    }

    @Test
    void anAdminSeesThatAKeyIsSetButNeverTheKey() throws Exception {
        signedInAs(true);

        mvc.perform(get("/admin/settings/ai").header(HttpHeaders.AUTHORIZATION, "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.platformModel").value("Qwen/Qwen3-8B-AWQ"))
                .andExpect(jsonPath("$.platformApiKeySet").value(true))
                .andExpect(jsonPath("$.platformApiKey").doesNotExist());
    }

    @Test
    void aKeyLeftOutIsKeptAndAnEmptyOneIsCleared() throws Exception {
        signedInAs(true);

        mvc.perform(put("/admin/settings/ai").header(HttpHeaders.AUTHORIZATION, "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"platformBaseUrl\":\"http://gpu:8000/v1\",\"platformModel\":\"m\",\"webSearchApiKey\":\"\"}"))
                .andExpect(status().isOk());

        ArgumentCaptor<UpdateAiSettingsRequest> sent = ArgumentCaptor.forClass(UpdateAiSettingsRequest.class);
        verify(aiServiceStub).updateAiSettings(sent.capture());
        assertThat(sent.getValue().hasPlatformApiKey()).isFalse();
        assertThat(sent.getValue().hasWebSearchApiKey()).isTrue();
        assertThat(sent.getValue().getWebSearchApiKey()).isEmpty();
        assertThat(sent.getValue().getPlatformBaseUrl()).isEqualTo("http://gpu:8000/v1");
    }

    @Test
    void anAdminSeesWhichSpeechRecognitionIsInUse() throws Exception {
        signedInAs(true);
        when(transcriptionServiceStub.getSpeechSettings(any())).thenReturn(SpeechSettings.newBuilder().setActive("local")
                .setSttModel("MediaTek-Research/Breeze-ASR-25").setDiarizationThreshold(0.6).build());

        mvc.perform(get("/admin/settings/speech").header(HttpHeaders.AUTHORIZATION, "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.active").value("local"))
                .andExpect(jsonPath("$.diarizationThreshold").value(0.6));
    }
}
