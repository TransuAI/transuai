package com.transuai.gateway.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
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
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

import com.transuai.auth.grpc.v1.AuthServiceGrpc;
import com.transuai.auth.grpc.v1.ChangePasswordResponse;
import com.transuai.auth.grpc.v1.User;
import com.transuai.gateway.RedisContainerConfig;
import com.transuai.gateway.TestAuth;
import com.transuai.gateway.security.JwtProperties;

/**
 * 要先改密碼（.scratch/initial-admin）：安裝時建立的管理員登入後，token 帶 pwc——只能看自己、改密碼、登出所有裝置，其他 API 一律 403
 * PASSWORD_CHANGE_REQUIRED。改好之後拿到的 token 沒有 pwc，照常使用。
 */
@SpringBootTest
@AutoConfigureMockMvc
@Import(RedisContainerConfig.class)
class PasswordChangeRequiredTest {

    @Autowired
    private MockMvc mvc;

    @Autowired
    private JwtProperties jwt;

    @MockitoBean
    private AuthServiceGrpc.AuthServiceBlockingStub authServiceStub;

    private final UUID admin = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        when(authServiceStub.withInterceptors(any())).thenReturn(authServiceStub);
        when(authServiceStub.getMe(any())).thenReturn(User.newBuilder().setId(admin.toString()).setEmail("admin@example.com")
                .setIsAdmin(true).setMustChangePassword(true).build());
        when(authServiceStub.changePassword(any())).thenReturn(ChangePasswordResponse.newBuilder()
                .setSignedIn(TestAuth.signedIn("admin@example.com")).build());
    }

    @Test
    void everythingElseWaitsUntilThePasswordIsChanged() throws Exception {
        String token = TestAuth.accessTokenThatMustChangePassword(jwt, admin);

        mvc.perform(get("/jobs").header("Authorization", "Bearer " + token))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error").value("PASSWORD_CHANGE_REQUIRED"));
        mvc.perform(get("/admin/settings/ai").header("Authorization", "Bearer " + token))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error").value("PASSWORD_CHANGE_REQUIRED"));
    }

    @Test
    void itCanSeeItselfAndChangeThePassword() throws Exception {
        String token = TestAuth.accessTokenThatMustChangePassword(jwt, admin);

        mvc.perform(get("/auth/me").header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.mustChangePassword").value(true));
        mvc.perform(post("/auth/password").header("Authorization", "Bearer " + token)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"currentPassword\":\"0f3a9c2e7b1d4f6a8c0e\",\"newPassword\":\"the admin's own password\"}"))
                .andExpect(status().isOk());
    }

    @Test
    void aTokenWithoutTheClaimWorksAsUsual() throws Exception {
        mvc.perform(get("/auth/me").header("Authorization", "Bearer " + TestAuth.accessToken(jwt, admin)))
                .andExpect(status().isOk());
        mvc.perform(get("/admin/settings/ai").header("Authorization", "Bearer " + TestAuth.accessToken(jwt, admin)))
                .andExpect(result -> assertThat(result.getResponse().getStatus()).isNotEqualTo(403));
    }
}
