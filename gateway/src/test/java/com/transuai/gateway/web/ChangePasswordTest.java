package com.transuai.gateway.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.ResultActions;

import com.transuai.auth.grpc.v1.AuthServiceGrpc;
import com.transuai.auth.grpc.v1.ChangePasswordResponse;
import com.transuai.gateway.RedisContainerConfig;
import com.transuai.gateway.TestAuth;
import com.transuai.gateway.security.JwtProperties;

import io.grpc.Status;

/** 改密碼（.scratch/pre-launch-hardening/issues/14）：要目前的密碼、猜錯太多次 429（跟刪除帳號合計）、成功時換一個新的 refresh cookie。 */
@SpringBootTest
@AutoConfigureMockMvc
@Import(RedisContainerConfig.class)
class ChangePasswordTest {

    @Autowired
    private MockMvc mvc;

    @Autowired
    private JwtProperties jwt;

    @MockitoBean
    private AuthServiceGrpc.AuthServiceBlockingStub authServiceStub;

    private final UUID user = UUID.randomUUID();
    private String token;

    @BeforeEach
    void setUp() {
        token = TestAuth.accessToken(jwt, user);
        when(authServiceStub.withInterceptors(any())).thenReturn(authServiceStub);
        when(authServiceStub.changePassword(any())).thenReturn(
                ChangePasswordResponse.newBuilder().setSignedIn(TestAuth.signedIn("a@example.com")).build());
    }

    @Test
    void theRightPasswordChangesItAndHandsOutAFreshRefreshCookie() throws Exception {
        MvcResult result = change("the-password", "a brand new password")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.accessToken").value("access"))
                .andExpect(jsonPath("$.refreshToken").doesNotExist())
                .andReturn();

        verify(authServiceStub).changePassword(argThat(request -> request.getCurrentPassword().equals("the-password")
                && request.getNewPassword().equals("a brand new password")));
        assertThat(result.getResponse().getHeader(HttpHeaders.SET_COOKIE)).startsWith("refresh_token=refresh;").contains("HttpOnly");
    }

    @Test
    void aWrongPasswordIsForbiddenAndANewPasswordThatBreaksTheRulesIsABadRequest() throws Exception {
        when(authServiceStub.changePassword(any())).thenThrow(Status.PERMISSION_DENIED.asRuntimeException());
        change("wrong", "a brand new password").andExpect(status().isForbidden());

        doThrow(Status.INVALID_ARGUMENT.withDescription("密碼至少要 12 個字元").asRuntimeException())
                .when(authServiceStub).changePassword(any());
        change("the-password", "short").andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value("密碼至少要 12 個字元"));
    }

    @Test
    void guessingTheCurrentPasswordCountsTogetherWithDeletingTheAccount() throws Exception {
        when(authServiceStub.changePassword(any())).thenThrow(Status.PERMISSION_DENIED.asRuntimeException());
        when(authServiceStub.deleteAccount(any())).thenThrow(Status.PERMISSION_DENIED.asRuntimeException());

        for (int i = 0; i < 3; i++) {
            change("wrong-" + i, "a brand new password").andExpect(status().isForbidden());
        }
        for (int i = 0; i < 2; i++) {
            mvc.perform(post("/auth/account/delete").header("Authorization", "Bearer " + token)
                    .contentType(MediaType.APPLICATION_JSON).content("{\"password\":\"wrong\"}")).andExpect(status().isForbidden());
        }
        change("wrong-again", "a brand new password").andExpect(status().isTooManyRequests());
    }

    @Test
    void bothPasswordsAreRequiredAndYouMustBeSignedIn() throws Exception {
        change("", "a brand new password").andExpect(status().isBadRequest());
        mvc.perform(post("/auth/password").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"currentPassword\":\"x\",\"newPassword\":\"y\"}"))
                .andExpect(status().isUnauthorized());

        verify(authServiceStub, never()).changePassword(any());
    }

    private ResultActions change(String current, String next) throws Exception {
        return mvc.perform(post("/auth/password").header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"currentPassword\":\"" + current + "\",\"newPassword\":\"" + next + "\"}"));
    }
}
