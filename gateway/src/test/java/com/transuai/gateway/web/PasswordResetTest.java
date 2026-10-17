package com.transuai.gateway.web;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Instant;
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

import com.transuai.auth.grpc.v1.AuthServiceGrpc;
import com.transuai.auth.grpc.v1.RequestPasswordResetResponse;
import com.transuai.auth.grpc.v1.ResetPasswordResponse;
import com.transuai.auth.grpc.v1.User;
import com.transuai.gateway.RedisContainerConfig;
import com.transuai.gateway.TestAuth;
import com.transuai.gateway.security.JwtProperties;

import io.grpc.Status;

/**
 * 忘記密碼（.scratch/pre-launch-hardening/issues/19）：不用登入；申請一律 202（不透露 email 有沒有註冊），每個 IP、每個 email 有上限；
 * 用連結設新密碼後，那位使用者的 access token 馬上不能用。
 */
@SpringBootTest(properties = {"app.rate-limit.password-reset.limit=3", "app.rate-limit.password-reset-per-email.limit=2"})
@AutoConfigureMockMvc
@Import(RedisContainerConfig.class)
class PasswordResetTest {

    @Autowired
    private MockMvc mvc;

    @Autowired
    private StringRedisTemplate redis;

    @Autowired
    private JwtProperties jwt;

    @MockitoBean
    private AuthServiceGrpc.AuthServiceBlockingStub authServiceStub;

    private final UUID user = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        redis.getConnectionFactory().getConnection().serverCommands().flushAll();
        when(authServiceStub.withInterceptors(any())).thenReturn(authServiceStub);
        when(authServiceStub.requestPasswordReset(any())).thenReturn(RequestPasswordResetResponse.getDefaultInstance());
        when(authServiceStub.getMe(any())).thenReturn(User.newBuilder().setId(user.toString()).setEmail("a@example.com").build());
    }

    @Test
    void askingForAResetNeedsNoSignInAndAlwaysSaysAccepted() throws Exception {
        request("a@example.com").andExpect(status().isAccepted());

        verify(authServiceStub).requestPasswordReset(argThat(r -> r.getEmail().equals("a@example.com")));
    }

    @Test
    void oneEmailCanOnlyBeSentSoManyAndOneAddressCanOnlyAskSoMany() throws Exception {
        request("a@example.com").andExpect(status().isAccepted());
        request("A@Example.com ").andExpect(status().isAccepted());
        request("a@example.com").andExpect(status().isTooManyRequests());  // third for this email

        request("b@example.com").andExpect(status().isTooManyRequests());  // fourth from this address
    }

    @Test
    void withoutMailSetUpItSaysSo() throws Exception {
        when(authServiceStub.requestPasswordReset(any())).thenThrow(Status.UNAVAILABLE
                .withDescription("這個系統沒有設定寄信，不能用「忘記密碼」；請洽管理這套系統的人員重設密碼").asRuntimeException());

        request("a@example.com").andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.message").value("這個系統沒有設定寄信，不能用「忘記密碼」；請洽管理這套系統的人員重設密碼"));
    }

    @Test
    void settingTheNewPasswordStopsTheUsersAccessTokensAtOnce() throws Exception {
        String sessionId = UUID.randomUUID().toString();
        String token = TestAuth.accessToken(jwt, user, sessionId, Instant.now());
        when(authServiceStub.resetPassword(any())).thenReturn(ResetPasswordResponse.newBuilder()
                .setUserId(user.toString()).addEndedSessionIds(sessionId).build());
        mvc.perform(get("/auth/me").header("Authorization", "Bearer " + token)).andExpect(status().isOk());

        confirm("the-token", "a brand new password").andExpect(status().isNoContent());

        verify(authServiceStub).resetPassword(argThat(r -> r.getToken().equals("the-token")
                && r.getNewPassword().equals("a brand new password")));
        mvc.perform(get("/auth/me").header("Authorization", "Bearer " + token)).andExpect(status().isUnauthorized());
    }

    @Test
    void anExpiredLinkIsAConflictAndMissingFieldsABadRequest() throws Exception {
        when(authServiceStub.resetPassword(any())).thenThrow(Status.FAILED_PRECONDITION
                .withDescription("這個重設連結無效或已過期，請重新申請").asRuntimeException());

        confirm("old", "a brand new password").andExpect(status().isConflict())
                .andExpect(jsonPath("$.message").value("這個重設連結無效或已過期，請重新申請"));
        mvc.perform(post("/auth/password-reset/confirm").contentType(MediaType.APPLICATION_JSON).content("{\"token\":\"x\"}"))
                .andExpect(status().isBadRequest());
        mvc.perform(post("/auth/password-reset").contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isBadRequest());
        verify(authServiceStub, never()).requestPasswordReset(any());
    }

    private ResultActions request(String email) throws Exception {
        return mvc.perform(post("/auth/password-reset").contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"" + email + "\"}"));
    }

    private ResultActions confirm(String token, String newPassword) throws Exception {
        return mvc.perform(post("/auth/password-reset/confirm").contentType(MediaType.APPLICATION_JSON)
                .content("{\"token\":\"" + token + "\",\"newPassword\":\"" + newPassword + "\"}"));
    }
}
