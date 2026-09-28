package com.transuai.gateway;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import com.transuai.auth.grpc.v1.AuthServiceGrpc;
import com.transuai.gateway.security.JwtProperties;
import com.transuai.upload.grpc.v1.Job;
import com.transuai.upload.grpc.v1.ListJobsResponse;
import com.transuai.upload.grpc.v1.UploadServiceGrpc;

import transuai.ai.v1.Ai.ListChaptersResponse;
import transuai.ai.v1.AiServiceGrpc;

/**
 * Redis 連不上時照常服務：限流放行（fail-open）、快取當作沒記住，照樣去問下游——Redis 故障不能把所有人擋在外面。
 */
@SpringBootTest(properties = {
        "spring.data.redis.port=1", "spring.data.redis.timeout=300ms", "spring.data.redis.connect-timeout=300ms",
        "app.rate-limit.login.limit=1", "app.rate-limit.login.window=15m",
        "app.rate-limit.register.limit=1", "app.rate-limit.register.window=1h",
        "app.rate-limit.per-user.limit=1", "app.rate-limit.per-address.limit=1",
})
@AutoConfigureMockMvc
class RedisDownTest {

    @Autowired
    private MockMvc mvc;

    @Autowired
    private JwtProperties jwt;

    @MockitoBean
    private AuthServiceGrpc.AuthServiceBlockingStub authServiceStub;

    @MockitoBean
    private UploadServiceGrpc.UploadServiceBlockingStub uploadServiceStub;

    @MockitoBean
    private AiServiceGrpc.AiServiceBlockingStub aiServiceStub;

    @Test
    void signingInAndUpStillWork() throws Exception {
        when(authServiceStub.login(any())).thenReturn(TestTokens.signedIn("a@example.com"));
        when(authServiceStub.register(any())).thenReturn(TestTokens.signedIn("a@example.com"));

        for (int i = 0; i < 3; i++) {  // 超過上限的 1 次
            for (String path : new String[] {"/auth/login", "/auth/register"}) {
                mvc.perform(post(path).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"a@example.com\",\"password\":\"whatever\"}"))
                        .andExpect(status().isOk());
            }
        }
    }

    @Test
    void theRestOfTheApiStillWorks() throws Exception {
        when(uploadServiceStub.withInterceptors(any())).thenReturn(uploadServiceStub);
        when(uploadServiceStub.listJobs(any())).thenReturn(ListJobsResponse.getDefaultInstance());
        String token = TestTokens.accessToken(jwt, UUID.randomUUID());

        for (int i = 0; i < 3; i++) {  // 超過每人 1 次的上限
            mvc.perform(get("/jobs?page=1&pageSize=10").header("Authorization", "Bearer " + token))
                    .andExpect(status().isOk());
        }
    }

    @Test
    void jobOwnershipIsCheckedWithUploadServiceEveryTime() throws Exception {
        when(uploadServiceStub.withInterceptors(any())).thenReturn(uploadServiceStub);
        when(uploadServiceStub.getJob(any())).thenReturn(Job.getDefaultInstance());
        when(aiServiceStub.listChapters(any())).thenReturn(ListChaptersResponse.getDefaultInstance());
        String token = TestTokens.accessToken(jwt, UUID.randomUUID());

        for (int i = 0; i < 2; i++) {
            mvc.perform(get("/chapters/11111111-1111-1111-1111-111111111111").header("Authorization", "Bearer " + token))
                    .andExpect(status().isOk());
        }

        verify(uploadServiceStub, times(2)).getJob(any());
    }
}
