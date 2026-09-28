package com.transuai.gateway.ratelimit;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import com.transuai.auth.grpc.v1.AuthServiceGrpc;

/** Redis 連不上時限流放行（fail-open）：Redis 故障不能把所有人擋在登入頁外面。 */
@SpringBootTest(properties = {
        "spring.data.redis.port=1", "spring.data.redis.timeout=300ms", "spring.data.redis.connect-timeout=300ms",
        "app.rate-limit.login.limit=1", "app.rate-limit.login.window=15m",
        "app.rate-limit.register.limit=1", "app.rate-limit.register.window=1h",
})
@AutoConfigureMockMvc
class AuthRateLimitWithoutRedisTest {

    @Autowired
    private MockMvc mvc;

    @MockitoBean
    private AuthServiceGrpc.AuthServiceBlockingStub authServiceStub;

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
}
