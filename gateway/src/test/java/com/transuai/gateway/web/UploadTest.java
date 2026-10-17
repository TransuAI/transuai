package com.transuai.gateway.web;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import com.transuai.gateway.RedisContainerConfig;
import com.transuai.gateway.TestAuth;
import com.transuai.gateway.security.JwtProperties;
import com.transuai.upload.grpc.v1.GetPresignedUploadUrlResponse;
import com.transuai.upload.grpc.v1.UploadServiceGrpc;

/** 取得上傳網址（.scratch/pre-launch-hardening/issues/16）：檔案的 MIME 類型轉給 upload-service 簽進網址。 */
@SpringBootTest
@AutoConfigureMockMvc
@Import(RedisContainerConfig.class)
class UploadTest {

    @Autowired
    private MockMvc mvc;

    @Autowired
    private JwtProperties jwt;

    @MockitoBean
    private UploadServiceGrpc.UploadServiceBlockingStub uploadServiceStub;

    private final UUID user = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        when(uploadServiceStub.withInterceptors(any())).thenReturn(uploadServiceStub);
        when(uploadServiceStub.getPresignedUploadUrl(any())).thenReturn(GetPresignedUploadUrlResponse.newBuilder()
                .setUploadUrl("http://storage/u").setStoragePath("uploads/x").build());
    }

    @Test
    void theFilesTypeGoesToUploadServiceToBeSignedIntoTheUrl() throws Exception {
        mvc.perform(post("/uploads/presign").header("Authorization", "Bearer " + TestAuth.accessToken(jwt, user))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"fileName\":\"a.m4a\",\"fileType\":\"AUDIO\",\"contentType\":\"audio/x-m4a\",\"fileSizeBytes\":10}"))
                .andExpect(status().isOk());

        verify(uploadServiceStub).getPresignedUploadUrl(argThat(request -> request.getContentType().equals("audio/x-m4a")));
    }
}
