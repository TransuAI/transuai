package com.transuai.gateway.ratelimit;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Date;
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
import com.transuai.upload.grpc.v1.ListJobsResponse;
import com.transuai.upload.grpc.v1.UploadServiceGrpc;

import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;

/** Redis 連不上時限流放行（fail-open）：Redis 故障不能把所有人擋在登入頁外面。 */
@SpringBootTest(properties = {
        "spring.data.redis.port=1", "spring.data.redis.timeout=300ms", "spring.data.redis.connect-timeout=300ms",
        "app.rate-limit.login.limit=1", "app.rate-limit.login.window=15m",
        "app.rate-limit.register.limit=1", "app.rate-limit.register.window=1h",
        "app.rate-limit.per-user.limit=1", "app.rate-limit.per-address.limit=1",
})
@AutoConfigureMockMvc
class AuthRateLimitWithoutRedisTest {

    @Autowired
    private MockMvc mvc;

    @Autowired
    private JwtProperties jwt;

    @MockitoBean
    private AuthServiceGrpc.AuthServiceBlockingStub authServiceStub;

    @MockitoBean
    private UploadServiceGrpc.UploadServiceBlockingStub uploadServiceStub;

    @Test
    void signingInAndUpStillWorkWhenRedisIsDown() throws Exception {
        when(authServiceStub.login(any())).thenReturn(AuthRateLimitTest.signedIn("a@example.com"));
        when(authServiceStub.register(any())).thenReturn(AuthRateLimitTest.signedIn("a@example.com"));

        for (int i = 0; i < 3; i++) {  // 超過上限的 1 次
            for (String path : new String[] {"/auth/login", "/auth/register"}) {
                mvc.perform(post(path).contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"a@example.com\",\"password\":\"whatever\"}"))
                        .andExpect(status().isOk());
            }
        }
    }

    @Test
    void theRestOfTheApiStillWorksWhenRedisIsDown() throws Exception {
        when(uploadServiceStub.withInterceptors(any())).thenReturn(uploadServiceStub);
        when(uploadServiceStub.listJobs(any())).thenReturn(ListJobsResponse.getDefaultInstance());
        String token = Jwts.builder().subject(UUID.randomUUID().toString()).claim("type", "access")
                .expiration(Date.from(Instant.now().plusSeconds(600)))
                .signWith(Keys.hmacShaKeyFor(jwt.secret().getBytes(StandardCharsets.UTF_8))).compact();

        for (int i = 0; i < 3; i++) {  // 超過每人 1 次的上限
            mvc.perform(get("/jobs?page=1&pageSize=10").header("Authorization", "Bearer " + token))
                    .andExpect(status().isOk());
        }
    }
}
