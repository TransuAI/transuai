package com.transuai.gateway.ratelimit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

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

import com.transuai.auth.grpc.v1.AuthResponse;
import com.transuai.auth.grpc.v1.AuthServiceGrpc;
import com.transuai.auth.grpc.v1.LoginRequest;
import com.transuai.auth.grpc.v1.RegisterRequest;
import com.transuai.auth.grpc.v1.User;
import com.transuai.gateway.RedisContainerConfig;

import io.grpc.Status;

/** 登入與註冊的限流（見 .scratch/pre-launch-hardening/issues/01）。上限在這裡調小，測試才不用打幾十次。 */
@SpringBootTest(properties = {
        "app.rate-limit.login-failures.limit=3", "app.rate-limit.login-failures.window=15m",
        "app.rate-limit.login.limit=5", "app.rate-limit.login.window=15m",
        "app.rate-limit.register.limit=2", "app.rate-limit.register.window=1h",
})
@AutoConfigureMockMvc
@Import(RedisContainerConfig.class)
class AuthRateLimitTest {

    private static final String PASSWORD = "correct-password";

    @Autowired
    private MockMvc mvc;

    @Autowired
    private StringRedisTemplate redis;

    @MockitoBean
    private AuthServiceGrpc.AuthServiceBlockingStub authServiceStub;

    @BeforeEach
    void startClean() {
        redis.getConnectionFactory().getConnection().serverCommands().flushAll();
        when(authServiceStub.login(any())).thenAnswer(invocation -> {
            LoginRequest request = invocation.getArgument(0);
            if (!PASSWORD.equals(request.getPassword())) {
                throw Status.UNAUTHENTICATED.withDescription("invalid email or password").asRuntimeException();
            }
            return signedIn(request.getEmail());
        });
        when(authServiceStub.register(any())).thenAnswer(invocation -> signedIn(
                invocation.<RegisterRequest>getArgument(0).getEmail()));
    }

    @Test
    void aFewWrongPasswordsForAnEmailBlockFurtherTries() throws Exception {
        for (int i = 0; i < 3; i++) {
            login("1.1.1.1", "a@example.com", "wrong").andExpect(status().isUnauthorized());
        }

        login("1.1.1.1", "a@example.com", PASSWORD)  // even the right password, until the window passes
                .andExpect(status().isTooManyRequests())
                .andExpect(jsonPath("$.error").value("RATE_LIMITED"))
                .andExpect(result -> assertThat(Long.parseLong(result.getResponse().getHeader("Retry-After")))
                        .isBetween(1L, 15 * 60L));
        verify(authServiceStub, times(3)).login(any());  // the blocked try never reaches auth-service
    }

    @Test
    void theMessageSaysWhenToTryAgain() throws Exception {
        for (int i = 0; i < 3; i++) {
            login("1.1.1.1", "a@example.com", "wrong");
        }

        login("1.1.1.1", "a@example.com", "wrong").andExpect(jsonPath("$.message").value(
                org.hamcrest.Matchers.containsString("分鐘後再試")));
    }

    @Test
    void theBlockIsForThatEmailFromThatAddressOnly() throws Exception {
        for (int i = 0; i < 3; i++) {
            login("1.1.1.1", "a@example.com", "wrong");
        }

        login("1.1.1.1", "b@example.com", PASSWORD).andExpect(status().isOk());
        login("2.2.2.2", "a@example.com", PASSWORD).andExpect(status().isOk());
    }

    @Test
    void theEmailIsMatchedTheWayAuthServiceMatchesIt() throws Exception {
        for (int i = 0; i < 3; i++) {
            login("1.1.1.1", "a@example.com", "wrong");
        }

        login("1.1.1.1", " A@Example.com ", PASSWORD).andExpect(status().isTooManyRequests());
    }

    @Test
    void signingInClearsTheFailures() throws Exception {
        login("1.1.1.1", "a@example.com", "wrong");
        login("1.1.1.1", "a@example.com", "wrong");
        login("1.1.1.1", "a@example.com", PASSWORD).andExpect(status().isOk());

        login("1.1.1.1", "a@example.com", "wrong").andExpect(status().isUnauthorized());
        login("1.1.1.1", "a@example.com", "wrong").andExpect(status().isUnauthorized());
    }

    @Test
    void oneAddressCanOnlyTryToSignInSoManyTimes() throws Exception {
        for (int i = 0; i < 5; i++) {
            login("1.1.1.1", "user" + i + "@example.com", PASSWORD).andExpect(status().isOk());
        }

        login("1.1.1.1", "user9@example.com", PASSWORD).andExpect(status().isTooManyRequests());
        login("2.2.2.2", "user9@example.com", PASSWORD).andExpect(status().isOk());
    }

    @Test
    void oneAddressCanOnlyRegisterSoManyTimes() throws Exception {
        register("1.1.1.1", "new1@example.com").andExpect(status().isOk());
        register("1.1.1.1", "new2@example.com").andExpect(status().isOk());

        register("1.1.1.1", "new3@example.com").andExpect(status().isTooManyRequests());
        verify(authServiceStub, never()).register(argThat(request -> request.getEmail().equals("new3@example.com")));
    }

    @Test
    void emailsAreNotStoredInRedis() throws Exception {
        login("1.1.1.1", "secret-person@example.com", "wrong");

        assertThat(redis.keys("*")).isNotEmpty().noneMatch(key -> key.contains("secret-person"));
    }

    private ResultActions login(String address, String email, String password) throws Exception {
        return mvc.perform(post("/auth/login").with(request -> {
            request.setRemoteAddr(address);
            return request;
        }).contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"%s\",\"password\":\"%s\"}".formatted(email, password)));
    }

    private ResultActions register(String address, String email) throws Exception {
        return mvc.perform(post("/auth/register").with(request -> {
            request.setRemoteAddr(address);
            return request;
        }).contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"%s\",\"password\":\"%s\"}".formatted(email, PASSWORD)));
    }

    private static AuthResponse signedIn(String email) {
        return AuthResponse.newBuilder().setAccessToken("access").setRefreshToken("refresh")
                .setUser(User.newBuilder().setId("00000000-0000-0000-0000-000000000001").setEmail(email.trim()))
                .build();
    }
}
