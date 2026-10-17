package com.transuai.gateway.ratelimit;

import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.not;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;

import com.transuai.auth.grpc.v1.AuthServiceGrpc;
import com.transuai.gateway.RedisContainerConfig;
import com.transuai.gateway.TestAuth;
import com.transuai.gateway.security.JwtProperties;
import com.transuai.upload.grpc.v1.ListJobsResponse;
import com.transuai.upload.grpc.v1.UploadServiceGrpc;

import jakarta.servlet.ServletException;
import transuai.ai.v1.Ai.ListQaHistoryResponse;
import transuai.ai.v1.AiServiceGrpc;

/**
 * 每個 API 都限流：登入的使用者每人一個總上限，沒登入的每個 IP 一個；花錢的功能（會觸發轉錄或呼叫 AI）另外有更嚴的每人上限
 * （見 .scratch/pre-launch-hardening/issues/02）。上限在這裡調小。
 */
@SpringBootTest(properties = {
        "app.rate-limit.per-user.limit=6", "app.rate-limit.per-user.window=1m",
        "app.rate-limit.per-address.limit=3", "app.rate-limit.per-address.window=1m",
        "app.rate-limit.costly.upload-url.limit=1", "app.rate-limit.costly.upload.limit=1",
        "app.rate-limit.costly.question.limit=1", "app.rate-limit.costly.quiz.limit=1",
        "app.rate-limit.costly.regenerate.limit=1", "app.rate-limit.costly.post-meeting.limit=1",
        "app.rate-limit.costly.provider-key.limit=1", "app.rate-limit.costly.transcript-edit.limit=1",
        "app.rate-limit.costly.linked-service.limit=1", "app.rate-limit.costly.claim-check.limit=1",
})
@AutoConfigureMockMvc
@Import(RedisContainerConfig.class)
class ApiRateLimitTest {

    private static final String JOB = "11111111-1111-1111-1111-111111111111";

    @Autowired
    private MockMvc mvc;

    @Autowired
    private StringRedisTemplate redis;

    @Autowired
    private JwtProperties jwt;

    @MockitoBean
    private AuthServiceGrpc.AuthServiceBlockingStub authServiceStub;

    @MockitoBean
    private UploadServiceGrpc.UploadServiceBlockingStub uploadServiceStub;

    @MockitoBean
    private AiServiceGrpc.AiServiceBlockingStub aiServiceStub;

    private final UUID alice = UUID.randomUUID();
    private final UUID bob = UUID.randomUUID();

    @BeforeEach
    void startClean() {
        redis.getConnectionFactory().getConnection().serverCommands().flushAll();
        when(uploadServiceStub.withInterceptors(any())).thenReturn(uploadServiceStub);
        when(uploadServiceStub.listJobs(any())).thenReturn(ListJobsResponse.getDefaultInstance());
        when(aiServiceStub.listQaHistory(any())).thenReturn(ListQaHistoryResponse.getDefaultInstance());
        when(authServiceStub.refresh(any())).thenReturn(TestAuth.signedIn("a@example.com"));
    }

    @Test
    void aSignedInUserHasOneLimitForAllRequests() throws Exception {
        for (int i = 0; i < 6; i++) {
            listJobs(alice).andExpect(status().isOk());
        }

        listJobs(alice).andExpect(status().isTooManyRequests())
                .andExpect(jsonPath("$.error").value("RATE_LIMITED"))
                .andExpect(jsonPath("$.message").value(containsString("分鐘後再試")));
        listJobs(bob).andExpect(status().isOk());  // 每個人各自計算
    }

    @Test
    void requestsWithoutSigningInAreLimitedByAddress() throws Exception {
        for (int i = 0; i < 3; i++) {
            refresh("1.1.1.1").andExpect(status().is(not(429)));
        }

        refresh("1.1.1.1").andExpect(status().isTooManyRequests());
        refresh("2.2.2.2").andExpect(status().is(not(429)));
    }

    @Test
    void aCostlyFeatureHasItsOwnStricterLimit() throws Exception {
        attempt(alice, HttpMethod.POST, "/uploads/complete");

        call(alice, HttpMethod.POST, "/uploads/complete").andExpect(status().isTooManyRequests());
        listJobs(alice).andExpect(status().isOk());  // 其他 API 照常
        attempt(bob, HttpMethod.POST, "/uploads/complete");
    }

    @ParameterizedTest(name = "{0} {1}")
    @CsvSource({
            "POST, /uploads/presign",
            "POST, /uploads/complete",
            "PATCH, /transcripts/" + JOB + "/segments/1",
            "PATCH, /transcripts/" + JOB + "/speakers/S1",
            "PUT, /transcripts/" + JOB + "/segments/1/speaker",
            "PUT, /me/default-model",
            "PUT, /me/post-meeting-settings",
            "GET, /me/connections/google/authorize",
            "POST, /jobs/" + JOB + "/post-meeting/22222222-2222-2222-2222-222222222222/execute",
            "POST, /qa/" + JOB,
            "POST, /jobs/" + JOB + "/quizzes",
            "POST, /summary/" + JOB + "/regenerate",
            "POST, /jobs/" + JOB + "/post-meeting",
            "PUT, /me/provider-keys/openai",
            "POST, /jobs/" + JOB + "/fact-check/verify",
    })
    void everyCostlyFeatureIsLimited(HttpMethod method, String path) throws Exception {
        attempt(alice, method, path);

        call(alice, method, path).andExpect(status().isTooManyRequests());
    }

    @Test
    void readingIsNotACostlyFeature() throws Exception {
        attempt(alice, HttpMethod.GET, "/qa/" + JOB);

        call(alice, HttpMethod.GET, "/qa/" + JOB).andExpect(status().is(not(429)));
    }

    /**
     * 呼叫一次，不管下游的結果：下游服務是 mock（回 null），controller 可能拋例外——這些測試只在乎這次有沒有被計入、
     * 下一次會不會被擋。
     */
    private void attempt(UUID user, HttpMethod method, String path) throws Exception {
        try {
            call(user, method, path).andExpect(status().is(not(429)));
        } catch (ServletException e) {
            // 下游的 mock 回了 null，controller 拋例外；這次仍然算數
        }
    }

    @Test
    void requestsWithABadTokenAreLimitedByAddressToo() throws Exception {
        for (int i = 0; i < 3; i++) {
            badToken("1.1.1.1").andExpect(status().isUnauthorized());
        }

        badToken("1.1.1.1").andExpect(status().isTooManyRequests())
                .andExpect(jsonPath("$.error").value("RATE_LIMITED"));
        badToken("2.2.2.2").andExpect(status().isUnauthorized());
    }

    @Test
    void apisOfTheSameCostlyFeatureShareOneCount() throws Exception {
        attempt(alice, HttpMethod.PATCH, "/transcripts/" + JOB + "/segments/1");

        call(alice, HttpMethod.PATCH, "/transcripts/" + JOB + "/speakers/S1").andExpect(status().isTooManyRequests());
    }

    private ResultActions badToken(String address) throws Exception {
        return mvc.perform(MockMvcRequestBuilders.get("/jobs").with(request -> {
            request.setRemoteAddr(address);
            return request;
        }).header("Authorization", "Bearer not-a-token"));
    }

    private ResultActions listJobs(UUID user) throws Exception {
        return call(user, HttpMethod.GET, "/jobs?page=1&pageSize=10");
    }

    private ResultActions refresh(String address) throws Exception {
        return mvc.perform(MockMvcRequestBuilders.post("/auth/refresh").with(request -> {
            request.setRemoteAddr(address);
            return request;
        }).cookie(new jakarta.servlet.http.Cookie("__Host-refresh_token", "x")));
    }

    private ResultActions call(UUID user, HttpMethod method, String path) throws Exception {
        return mvc.perform(MockMvcRequestBuilders.request(method, path)
                .header("Authorization", "Bearer " + TestAuth.accessToken(jwt, user))
                .contentType(MediaType.APPLICATION_JSON).content("{}"));
    }

}
