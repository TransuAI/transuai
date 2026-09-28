package com.transuai.gateway.web;

import java.util.UUID;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.transuai.auth.grpc.v1.AuthResponse;
import com.transuai.auth.grpc.v1.AuthServiceGrpc;
import com.transuai.auth.grpc.v1.GetMeRequest;
import com.transuai.auth.grpc.v1.LoginRequest;
import com.transuai.auth.grpc.v1.RefreshRequest;
import com.transuai.auth.grpc.v1.RegisterRequest;
import com.transuai.auth.grpc.v1.User;
import com.transuai.gateway.grpc.GrpcMetadataSupport;
import com.transuai.gateway.grpc.GrpcTimestamps;
import com.transuai.gateway.ratelimit.AuthRateLimits;
import com.transuai.gateway.web.dto.AuthResponseDto;
import com.transuai.gateway.web.dto.LoginRequestDto;
import com.transuai.gateway.web.dto.RefreshRequestDto;
import com.transuai.gateway.web.dto.RegisterRequestDto;
import com.transuai.gateway.web.dto.UserDto;

import io.grpc.Status;
import io.grpc.StatusRuntimeException;
import jakarta.servlet.http.HttpServletRequest;

import lombok.RequiredArgsConstructor;

// 對應 ../../architecture-design.md 3.1（原文件用 Spring Boot + Spring Security 直接做 Auth Service 的
// REST API；這裡 Auth Service 本身只講 gRPC，REST 是這個 Gateway 轉出來的，跟平台其他服務一致）。
@RestController
@RequestMapping("/auth")
@RequiredArgsConstructor
public class AuthController {

    private final AuthServiceGrpc.AuthServiceBlockingStub authServiceStub;
    private final AuthRateLimits rateLimits;

    // 限流用的 IP 是 getRemoteAddr()：正式環境在反向代理後面時，靠 server.forward-headers-strategy（見 application.properties）
    // 從代理設的 X-Forwarded-For 取得真正的來源。
    @PostMapping("/register")
    public AuthResponseDto register(@RequestBody RegisterRequestDto request, HttpServletRequest http) {
        rateLimits.beforeRegister(http.getRemoteAddr());
        AuthResponse response = authServiceStub.register(RegisterRequest.newBuilder()
                .setEmail(request.email())
                .setPassword(request.password())
                .setDisplayName(request.displayName() == null ? "" : request.displayName())
                .build());
        return toDto(response);
    }

    @PostMapping("/login")
    public AuthResponseDto login(@RequestBody LoginRequestDto request, HttpServletRequest http) {
        String address = http.getRemoteAddr();
        rateLimits.beforeLogin(address, request.email());
        AuthResponse response;
        try {
            response = authServiceStub.login(LoginRequest.newBuilder()
                    .setEmail(request.email())
                    .setPassword(request.password())
                    .build());
        } catch (StatusRuntimeException e) {
            if (e.getStatus().getCode() == Status.Code.UNAUTHENTICATED) {
                rateLimits.loginFailed(address, request.email());
            }
            throw e;
        }
        rateLimits.loginSucceeded(address, request.email());
        return toDto(response);
    }

    @PostMapping("/refresh")
    public AuthResponseDto refresh(@RequestBody RefreshRequestDto request) {
        AuthResponse response = authServiceStub.refresh(RefreshRequest.newBuilder()
                .setRefreshToken(request.refreshToken())
                .build());
        return toDto(response);
    }

    @GetMapping("/me")
    public UserDto me(@CurrentUserId UUID userId) {
        User user = GrpcMetadataSupport.withUserId(authServiceStub, userId)
                .getMe(GetMeRequest.newBuilder().build());
        return toDto(user);
    }

    private static AuthResponseDto toDto(AuthResponse response) {
        return new AuthResponseDto(response.getAccessToken(), response.getRefreshToken(), toDto(response.getUser()));
    }

    private static UserDto toDto(User user) {
        return new UserDto(user.getId(), user.getEmail(), user.getDisplayName(),
                GrpcTimestamps.toInstant(user.getCreatedAt()));
    }
}
