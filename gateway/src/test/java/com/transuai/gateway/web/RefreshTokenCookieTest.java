package com.transuai.gateway.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.argThat;
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

import com.transuai.auth.grpc.v1.AuthResponse;
import com.transuai.auth.grpc.v1.AuthServiceGrpc;
import com.transuai.auth.grpc.v1.LogoutResponse;
import com.transuai.auth.grpc.v1.User;
import com.transuai.gateway.RedisContainerConfig;
import com.transuai.gateway.TestAuth;
import com.transuai.gateway.security.JwtProperties;

import io.grpc.Status;
import jakarta.servlet.http.Cookie;

/**
 * refresh token 放在 httpOnly cookie、不在回應本文（見 .scratch/pre-launch-hardening/issues/09）；換發、登出從 cookie 拿；
 * 登出（見 issues/08）作廢 refresh token 並清掉 cookie。
 */
@SpringBootTest
@AutoConfigureMockMvc
@Import(RedisContainerConfig.class)
class RefreshTokenCookieTest {

    private static final String LOGIN = "{\"email\":\"a@example.com\",\"password\":\"secret-password\"}";

    @Autowired
    private MockMvc mvc;

    @Autowired
    private JwtProperties jwt;

    @MockitoBean
    private AuthServiceGrpc.AuthServiceBlockingStub authServiceStub;

    @BeforeEach
    void setUp() {
        when(authServiceStub.withInterceptors(any())).thenReturn(authServiceStub);
        when(authServiceStub.login(any())).thenReturn(issued("access-1", "refresh-1"));
        when(authServiceStub.register(any())).thenReturn(issued("access-1", "refresh-1"));
        when(authServiceStub.refresh(any())).thenReturn(issued("access-2", "refresh-2"));
        when(authServiceStub.logout(any())).thenReturn(LogoutResponse.getDefaultInstance());
        when(authServiceStub.logoutAllDevices(any())).thenReturn(LogoutResponse.getDefaultInstance());
    }

    @Test
    void signingInPutsTheRefreshTokenInAnHttpOnlyStrictCookieAndNotInTheBody() throws Exception {
        for (String path : new String[] {"/auth/login", "/auth/register"}) {
            MvcResult result = mvc.perform(post(path).contentType(MediaType.APPLICATION_JSON).content(LOGIN))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.accessToken").value("access-1"))
                    .andExpect(jsonPath("$.user.email").value("a@example.com"))
                    .andExpect(jsonPath("$.refreshToken").doesNotExist())
                    .andReturn();

            assertThat(setCookie(result)).startsWith("__Host-refresh_token=refresh-1;")
                    .contains("Path=/;", "Max-Age=604800", "Secure", "HttpOnly", "SameSite=Strict")
                    // __Host- (ASVS 3.4.4): browsers only accept it Secure, with Path=/ and no Domain.
                    .doesNotContain("Domain");
        }
    }

    @Test
    void refreshingUsesTheCookieAndRotatesIt() throws Exception {
        MvcResult result = mvc.perform(post("/auth/refresh").cookie(new Cookie("__Host-refresh_token", "refresh-1")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.accessToken").value("access-2"))
                .andExpect(jsonPath("$.refreshToken").doesNotExist())
                .andReturn();

        verify(authServiceStub).refresh(argThat(request -> request.getRefreshToken().equals("refresh-1")));
        assertThat(setCookie(result)).startsWith("__Host-refresh_token=refresh-2;");
    }

    @Test
    void refreshingWithoutTheCookieIsUnauthorized() throws Exception {
        mvc.perform(post("/auth/refresh")).andExpect(status().isUnauthorized());

        verify(authServiceStub, never()).refresh(any());
    }

    @Test
    void aRefreshTokenAuthServiceRejectsIsClearedFromTheBrowser() throws Exception {
        when(authServiceStub.refresh(any())).thenThrow(Status.UNAUTHENTICATED.asRuntimeException());

        MvcResult result = mvc.perform(post("/auth/refresh").cookie(new Cookie("__Host-refresh_token", "revoked")))
                .andExpect(status().isUnauthorized())
                .andReturn();

        assertThat(setCookie(result)).startsWith("__Host-refresh_token=;").contains("Max-Age=0", "Path=/");
    }

    @Test
    void loggingOutRevokesTheCookiesRefreshTokenWithoutNeedingAnAccessTokenAndClearsIt() throws Exception {
        MvcResult result = mvc.perform(post("/auth/logout").cookie(new Cookie("__Host-refresh_token", "the-token")))
                .andExpect(status().isNoContent())
                .andReturn();

        verify(authServiceStub).logout(argThat(request -> request.getRefreshToken().equals("the-token")));
        assertThat(setCookie(result)).startsWith("__Host-refresh_token=;").contains("Max-Age=0");
    }

    @Test
    void loggingOutWithoutTheCookieStillSucceeds() throws Exception {
        mvc.perform(post("/auth/logout")).andExpect(status().isNoContent());

        verify(authServiceStub, never()).logout(any());
    }

    @Test
    void loggingOutOfAllDevicesNeedsYouToBeSignedInAndClearsTheCookie() throws Exception {
        mvc.perform(post("/auth/logout-all")).andExpect(status().isUnauthorized());
        verify(authServiceStub, never()).logoutAllDevices(any());

        MvcResult result = mvc.perform(post("/auth/logout-all")
                        .header("Authorization", "Bearer " + TestAuth.accessToken(jwt, UUID.randomUUID())))
                .andExpect(status().isNoContent())
                .andReturn();
        verify(authServiceStub).logoutAllDevices(any());
        assertThat(setCookie(result)).startsWith("__Host-refresh_token=;").contains("Max-Age=0");
    }

    private static AuthResponse issued(String accessToken, String refreshToken) {
        return AuthResponse.newBuilder().setAccessToken(accessToken).setRefreshToken(refreshToken)
                .setUser(User.newBuilder().setId("00000000-0000-0000-0000-000000000001").setEmail("a@example.com"))
                .build();
    }

    private static String setCookie(MvcResult result) {
        return result.getResponse().getHeader(HttpHeaders.SET_COOKIE);
    }
}
