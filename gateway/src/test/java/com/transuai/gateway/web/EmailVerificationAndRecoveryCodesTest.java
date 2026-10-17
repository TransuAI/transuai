package com.transuai.gateway.web;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.argThat;
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
import com.transuai.auth.grpc.v1.GenerateRecoveryCodesResponse;
import com.transuai.auth.grpc.v1.ResendEmailVerificationResponse;
import com.transuai.auth.grpc.v1.ResetPasswordResponse;
import com.transuai.auth.grpc.v1.User;
import com.transuai.auth.grpc.v1.VerifyEmailResponse;
import com.transuai.gateway.RedisContainerConfig;
import com.transuai.gateway.TestAuth;
import com.transuai.gateway.security.JwtProperties;

import io.grpc.Status;

/** 確認 email 與復原碼（.scratch/pre-launch-hardening/issues/24）：哪些不用登入、上限、復原碼重設後 access token 馬上不能用。 */
@SpringBootTest(properties = "app.rate-limit.password-reset-per-email.limit=2")
@AutoConfigureMockMvc
@Import(RedisContainerConfig.class)
class EmailVerificationAndRecoveryCodesTest {

    @Autowired
    private MockMvc mvc;

    @Autowired
    private StringRedisTemplate redis;

    @Autowired
    private JwtProperties jwt;

    @MockitoBean
    private AuthServiceGrpc.AuthServiceBlockingStub authServiceStub;

    private final UUID user = UUID.randomUUID();
    private String token;

    @BeforeEach
    void setUp() {
        redis.getConnectionFactory().getConnection().serverCommands().flushAll();
        token = TestAuth.accessToken(jwt, user, UUID.randomUUID().toString(), Instant.now());
        when(authServiceStub.withInterceptors(any())).thenReturn(authServiceStub);
        when(authServiceStub.verifyEmail(any())).thenReturn(VerifyEmailResponse.getDefaultInstance());
        when(authServiceStub.resendEmailVerification(any())).thenReturn(ResendEmailVerificationResponse.getDefaultInstance());
        when(authServiceStub.getMe(any())).thenReturn(User.newBuilder().setId(user.toString()).setEmail("a@example.com")
                .setEmailVerified(true).setRecoveryCodesLeft(7).build());
    }

    @Test
    void theUserSaysWhetherTheEmailIsConfirmedAndHowManyCodesAreLeft() throws Exception {
        mvc.perform(get("/auth/me").header("Authorization", "Bearer " + token))
                .andExpect(jsonPath("$.emailVerified").value(true))
                .andExpect(jsonPath("$.recoveryCodesLeft").value(7));
    }

    @Test
    void confirmingNeedsNoSignInButResendingDoesAndIsLimited() throws Exception {
        json(post("/auth/verify-email"), "{\"token\":\"t\"}").andExpect(status().isNoContent());
        verify(authServiceStub).verifyEmail(argThat(r -> r.getToken().equals("t")));

        mvc.perform(post("/auth/verify-email/resend")).andExpect(status().isUnauthorized());
        resend().andExpect(status().isAccepted());
        resend().andExpect(status().isAccepted());
        resend().andExpect(status().isTooManyRequests());
    }

    @Test
    void codesNeedTheCurrentPasswordAndComeBackOnce() throws Exception {
        when(authServiceStub.generateRecoveryCodes(any()))
                .thenReturn(GenerateRecoveryCodesResponse.newBuilder().addCodes("AAAAA-BBBBB-CCCCC-DDDDD").build());

        json(post("/auth/recovery-codes").header("Authorization", "Bearer " + token), "{\"currentPassword\":\"pw\"}")
                .andExpect(status().isOk()).andExpect(jsonPath("$.codes[0]").value("AAAAA-BBBBB-CCCCC-DDDDD"));
        json(post("/auth/recovery-codes"), "{\"currentPassword\":\"pw\"}").andExpect(status().isUnauthorized());
    }

    @Test
    void resettingWithACodeNeedsNoSignInStopsTheUsersTokensAndGuessingIsLimited() throws Exception {
        String sessionId = UUID.randomUUID().toString();
        String signedIn = TestAuth.accessToken(jwt, user, sessionId, Instant.now());
        when(authServiceStub.resetPasswordWithRecoveryCode(any())).thenReturn(ResetPasswordResponse.newBuilder()
                .setUserId(user.toString()).addEndedSessionIds(sessionId).build());

        reset("a@example.com", "AAAAA-BBBBB-CCCCC-DDDDD").andExpect(status().isNoContent());
        mvc.perform(get("/auth/me").header("Authorization", "Bearer " + signedIn)).andExpect(status().isUnauthorized());

        when(authServiceStub.resetPasswordWithRecoveryCode(any())).thenThrow(Status.FAILED_PRECONDITION
                .withDescription("email 或復原碼不對，或這組復原碼已經用過了").asRuntimeException());
        for (int i = 0; i < 5; i++) {
            reset("b@example.com", "guess-" + i).andExpect(status().isConflict());
        }
        reset("b@example.com", "guess-again").andExpect(status().isTooManyRequests());
    }

    private ResultActions resend() throws Exception {
        return mvc.perform(post("/auth/verify-email/resend").header("Authorization", "Bearer " + token));
    }

    private ResultActions reset(String email, String code) throws Exception {
        return json(post("/auth/password-reset/recovery-code"),
                "{\"email\":\"" + email + "\",\"code\":\"" + code + "\",\"newPassword\":\"a brand new password\"}");
    }

    private ResultActions json(org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder request, String body)
            throws Exception {
        return mvc.perform(request.contentType(MediaType.APPLICATION_JSON).content(body));
    }
}
