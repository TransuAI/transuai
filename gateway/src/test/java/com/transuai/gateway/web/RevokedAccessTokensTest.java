package com.transuai.gateway.web;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Instant;
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
import org.springframework.test.web.servlet.ResultActions;

import com.transuai.auth.grpc.v1.AuthServiceGrpc;
import com.transuai.auth.grpc.v1.ChangePasswordResponse;
import com.transuai.auth.grpc.v1.LogoutResponse;
import com.transuai.auth.grpc.v1.User;
import com.transuai.gateway.RedisContainerConfig;
import com.transuai.gateway.TestAuth;
import com.transuai.gateway.security.JwtProperties;

import jakarta.servlet.http.Cookie;

/**
 * 登出時 access token 立即失效（.scratch/pre-launch-hardening/issues/18，ASVS 3.3.1）：登出那一次登入（sid）簽的、登出所有裝置與改密碼之前
 * 簽的（iat），都馬上不能用；其他登入、之後簽的照樣能用。
 */
@SpringBootTest
@AutoConfigureMockMvc
@Import(RedisContainerConfig.class)
class RevokedAccessTokensTest {

    @Autowired
    private MockMvc mvc;

    @Autowired
    private JwtProperties jwt;

    @MockitoBean
    private AuthServiceGrpc.AuthServiceBlockingStub authServiceStub;

    private final UUID user = UUID.randomUUID();
    private final String thisSignIn = UUID.randomUUID().toString();
    private final String otherSignIn = UUID.randomUUID().toString();

    @BeforeEach
    void setUp() {
        when(authServiceStub.withInterceptors(any())).thenReturn(authServiceStub);
        when(authServiceStub.getMe(any())).thenReturn(User.newBuilder().setId(user.toString()).setEmail("a@example.com").build());
        when(authServiceStub.logout(any())).thenReturn(LogoutResponse.newBuilder().setSessionId(thisSignIn).build());
        when(authServiceStub.logoutAllDevices(any())).thenReturn(
                LogoutResponse.newBuilder().addEndedSessionIds(thisSignIn).addEndedSessionIds(otherSignIn).build());
        when(authServiceStub.changePassword(any())).thenReturn(ChangePasswordResponse.newBuilder()
                .setSignedIn(TestAuth.signedIn("a@example.com")).addEndedSessionIds(thisSignIn).addEndedSessionIds(otherSignIn).build());
    }

    @Test
    void loggingOutStopsThatSignInsAccessTokensButNotAnotherSignIns() throws Exception {
        String token = token(thisSignIn, Instant.now());
        String otherDevice = token(otherSignIn, Instant.now());
        me(token).andExpect(status().isOk());

        mvc.perform(post("/auth/logout").cookie(new Cookie("refresh_token", "refresh"))).andExpect(status().isNoContent());

        me(token).andExpect(status().isUnauthorized());
        me(otherDevice).andExpect(status().isOk());
    }

    @Test
    void loggingOutOfEveryDeviceStopsTheAccessTokensOfEverySignInThatEnded() throws Exception {
        // Issued in the same second as the logout: only the sign-in id tells them apart from what comes after.
        String thisDevice = token(thisSignIn, Instant.now());
        String otherDevice = token(otherSignIn, Instant.now());

        mvc.perform(post("/auth/logout-all").header("Authorization", "Bearer " + thisDevice)).andExpect(status().isNoContent());

        me(thisDevice).andExpect(status().isUnauthorized());
        me(otherDevice).andExpect(status().isUnauthorized());
        me(token(UUID.randomUUID().toString(), Instant.now())).andExpect(status().isOk());  // signed in again, same second
    }

    @Test
    void changingThePasswordStopsTheOtherSignInsButNotTheOneItHandsOut() throws Exception {
        String otherDevice = token(otherSignIn, Instant.now());

        mvc.perform(post("/auth/password").header("Authorization", "Bearer " + token(thisSignIn, Instant.now()))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"currentPassword\":\"old one\",\"newPassword\":\"a brand new password\"}")).andExpect(status().isOk());

        me(otherDevice).andExpect(status().isUnauthorized());
        me(token(UUID.randomUUID().toString(), Instant.now())).andExpect(status().isOk());  // the new sign-in
    }

    @Test
    void aTokenFromBeforeSignInsHadAnIdStillWorksUntilEveryDeviceIsLoggedOut() throws Exception {
        String old = TestAuth.accessToken(jwt, user);  // no sid, no iat
        mvc.perform(post("/auth/logout").cookie(new Cookie("refresh_token", "refresh"))).andExpect(status().isNoContent());
        me(old).andExpect(status().isOk());

        mvc.perform(post("/auth/logout-all").header("Authorization", "Bearer " + old)).andExpect(status().isNoContent());

        me(old).andExpect(status().isUnauthorized());
    }

    private String token(String sessionId, Instant issuedAt) {
        return TestAuth.accessToken(jwt, user, sessionId, issuedAt);
    }

    private ResultActions me(String token) throws Exception {
        return mvc.perform(get("/auth/me").header("Authorization", "Bearer " + token));
    }
}
