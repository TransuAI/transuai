package com.transuai.gateway.web;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

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

import com.transuai.auth.grpc.v1.AuthServiceGrpc;
import com.transuai.auth.grpc.v1.LogoutResponse;
import com.transuai.gateway.RedisContainerConfig;
import com.transuai.gateway.TestAuth;
import com.transuai.gateway.security.JwtProperties;

/** 登出（見 .scratch/pre-launch-hardening/issues/08）：作廢 refresh token；登出所有裝置要先登入。 */
@SpringBootTest
@AutoConfigureMockMvc
@Import(RedisContainerConfig.class)
class LogoutTest {

    @Autowired
    private MockMvc mvc;

    @Autowired
    private JwtProperties jwt;

    @MockitoBean
    private AuthServiceGrpc.AuthServiceBlockingStub authServiceStub;

    @BeforeEach
    void setUp() {
        when(authServiceStub.withInterceptors(any())).thenReturn(authServiceStub);
        when(authServiceStub.logout(any())).thenReturn(LogoutResponse.getDefaultInstance());
        when(authServiceStub.logoutAllDevices(any())).thenReturn(LogoutResponse.getDefaultInstance());
    }

    @Test
    void loggingOutPassesTheRefreshTokenOnWithoutNeedingAnAccessToken() throws Exception {
        mvc.perform(post("/auth/logout").contentType(MediaType.APPLICATION_JSON).content("{\"refreshToken\":\"the-token\"}"))
                .andExpect(status().isNoContent());

        verify(authServiceStub).logout(argThat(request -> request.getRefreshToken().equals("the-token")));
    }

    @Test
    void loggingOutOfAllDevicesNeedsYouToBeSignedIn() throws Exception {
        mvc.perform(post("/auth/logout-all")).andExpect(status().isUnauthorized());
        verify(authServiceStub, never()).logoutAllDevices(any());

        mvc.perform(post("/auth/logout-all").header("Authorization", "Bearer " + TestAuth.accessToken(jwt, UUID.randomUUID())))
                .andExpect(status().isNoContent());
        verify(authServiceStub).logoutAllDevices(any());
    }
}
