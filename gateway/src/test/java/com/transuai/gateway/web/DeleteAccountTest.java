package com.transuai.gateway.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
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
import com.transuai.auth.grpc.v1.DeleteAccountResponse;
import com.transuai.auth.grpc.v1.User;
import com.transuai.gateway.RedisContainerConfig;
import com.transuai.gateway.TestAuth;
import com.transuai.gateway.security.JwtProperties;

import io.grpc.Status;

/** 刪除帳號（見 .scratch/account-deletion/issues/02）：再輸入一次密碼、猜錯太多次 429、刪除後舊的 access token 不能用、清掉 cookie。 */
@SpringBootTest
@AutoConfigureMockMvc
@Import(RedisContainerConfig.class)
class DeleteAccountTest {

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
        when(authServiceStub.deleteAccount(any())).thenReturn(DeleteAccountResponse.getDefaultInstance());
        when(authServiceStub.getMe(any())).thenReturn(User.newBuilder().setId(user.toString()).setEmail("a@example.com").build());
    }

    @Test
    void theRightPasswordDeletesTheAccountClearsTheCookieAndTheOldAccessTokenStopsWorking() throws Exception {
        mvc.perform(get("/auth/me").header("Authorization", "Bearer " + token)).andExpect(status().isOk());

        MvcResult result = delete("the-password").andExpect(status().isNoContent()).andReturn();

        verify(authServiceStub).deleteAccount(argThat(request -> request.getPassword().equals("the-password")));
        assertThat(result.getResponse().getHeader(HttpHeaders.SET_COOKIE)).startsWith("refresh_token=;").contains("Max-Age=0");
        mvc.perform(get("/auth/me").header("Authorization", "Bearer " + token)).andExpect(status().isUnauthorized());
    }

    @Test
    void aWrongPasswordIsForbiddenAndTheAccountStaysUsable() throws Exception {
        when(authServiceStub.deleteAccount(any())).thenThrow(Status.PERMISSION_DENIED.asRuntimeException());

        delete("wrong").andExpect(status().isForbidden());

        mvc.perform(get("/auth/me").header("Authorization", "Bearer " + token)).andExpect(status().isOk());
    }

    @Test
    void guessingThePasswordTooOftenIsRateLimited() throws Exception {
        when(authServiceStub.deleteAccount(any())).thenThrow(Status.PERMISSION_DENIED.asRuntimeException());

        for (int i = 0; i < 5; i++) {
            delete("wrong-" + i).andExpect(status().isForbidden());
        }
        delete("wrong-again").andExpect(status().isTooManyRequests());
    }

    @Test
    void aPasswordIsRequiredAndYouMustBeSignedIn() throws Exception {
        delete("").andExpect(status().isBadRequest());
        mvc.perform(post("/auth/account/delete").contentType(MediaType.APPLICATION_JSON).content("{\"password\":\"x\"}"))
                .andExpect(status().isUnauthorized());

        verify(authServiceStub, never()).deleteAccount(any());
    }

    private ResultActions delete(String password) throws Exception {
        return mvc.perform(post("/auth/account/delete").header("Authorization", "Bearer " + token)
                .contentType(MediaType.APPLICATION_JSON).content("{\"password\":\"" + password + "\"}"));
    }
}
