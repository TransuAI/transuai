package com.transuai.gateway.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

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
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;

import com.transuai.gateway.RedisContainerConfig;
import com.transuai.gateway.TestAuth;
import com.transuai.gateway.security.JwtProperties;
import com.transuai.upload.grpc.v1.UploadServiceGrpc;

import io.grpc.Status;

/**
 * 上線前驗證（.scratch/pre-launch-hardening/issues/13，ASVS 7.4.1、8.2.1、14.4）：每個回應都有安全標頭；伺服器端的錯誤不把細節給使用者。
 */
@SpringBootTest
@AutoConfigureMockMvc
@Import(RedisContainerConfig.class)
class SecurityHeadersTest {

    @Autowired
    private MockMvc mvc;

    @Autowired
    private StringRedisTemplate redis;

    @Autowired
    private JwtProperties jwt;

    @MockitoBean
    private UploadServiceGrpc.UploadServiceBlockingStub uploadServiceStub;

    private final UUID user = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        redis.getConnectionFactory().getConnection().serverCommands().flushAll();
        when(uploadServiceStub.withInterceptors(any())).thenReturn(uploadServiceStub);
    }

    @Test
    void everyResponseCarriesTheSecurityHeadersEvenWhenTheTokenIsMissing() throws Exception {
        expectSecurityHeaders(mvc.perform(MockMvcRequestBuilders.get("/jobs")).andExpect(status().isUnauthorized()));
    }

    @Test
    void aSignedInResponseCarriesThemToo() throws Exception {
        when(uploadServiceStub.listJobs(any())).thenReturn(com.transuai.upload.grpc.v1.ListJobsResponse.getDefaultInstance());

        expectSecurityHeaders(get("/jobs").andExpect(status().isOk()));
    }

    @Test
    void aServerErrorDoesNotTellTheUserWhatWentWrongInside() throws Exception {
        when(uploadServiceStub.listJobs(any())).thenThrow(Status.UNKNOWN
                .withDescription("Exception calling application: relation \"jobs\" does not exist").asRuntimeException());

        String body = get("/jobs")
                .andExpect(status().isInternalServerError())
                .andExpect(jsonPath("$.error").value("INTERNAL"))
                .andReturn().getResponse().getContentAsString();

        assertThat(body).contains("伺服器發生錯誤，請稍後再試（錯誤代碼 ").doesNotContain("relation").doesNotContain("Exception");
    }

    @Test
    void aMessageWrittenForTheUserWhenAServiceIsBusyStillGetsThrough() throws Exception {
        when(uploadServiceStub.listJobs(any())).thenThrow(Status.UNAVAILABLE.withDescription("暫時無法產生，請稍後再試").asRuntimeException());

        get("/jobs").andExpect(status().isServiceUnavailable()).andExpect(jsonPath("$.message").value("暫時無法產生，請稍後再試"));
    }

    @Test
    void anUnknownFileTypeIsRejectedWithoutNamingInternalClasses() throws Exception {
        String body = mvc.perform(MockMvcRequestBuilders.post("/uploads/presign")
                        .header("Authorization", "Bearer " + TestAuth.accessToken(jwt, user))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"fileName\":\"a.html\",\"fileType\":\"HTML\",\"fileSizeBytes\":10}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value("fileType must be AUDIO or VIDEO"))
                .andReturn().getResponse().getContentAsString();

        assertThat(body).doesNotContain("com.transuai");
    }

    private ResultActions get(String path) throws Exception {
        return mvc.perform(MockMvcRequestBuilders.get(path).header("Authorization", "Bearer " + TestAuth.accessToken(jwt, user)));
    }

    private static void expectSecurityHeaders(ResultActions result) throws Exception {
        result.andExpect(header().string("X-Content-Type-Options", "nosniff"))
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(header().string("X-Frame-Options", "DENY"))
                .andExpect(header().string("Referrer-Policy", "no-referrer"))
                .andExpect(header().string("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'"))
                .andExpect(header().string("Content-Disposition", "attachment; filename=\"api.json\""));
    }
}
