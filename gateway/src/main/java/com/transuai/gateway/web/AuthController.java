package com.transuai.gateway.web;

import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import com.transuai.auth.grpc.v1.AuthResponse;
import com.transuai.auth.grpc.v1.AuthServiceGrpc;
import com.transuai.auth.grpc.v1.GetMeRequest;
import com.transuai.auth.grpc.v1.LoginRequest;
import com.transuai.auth.grpc.v1.LogoutAllDevicesRequest;
import com.transuai.auth.grpc.v1.LogoutRequest;
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

    // 限流用的 IP 是 getRemoteAddr()，預設就是直接連進來的位址（不看使用者可以自己填的 X-Forwarded-For；在反向代理後面時
    // 怎麼設定見 gateway README「限流」）。
    @PostMapping("/register")
    public AuthResponseDto register(@RequestBody RegisterRequestDto request, HttpServletRequest servletRequest) {
        requireCredentials(request.email(), request.password());
        rateLimits.beforeRegister(servletRequest.getRemoteAddr());
        AuthResponse response = authServiceStub.register(RegisterRequest.newBuilder()
                .setEmail(request.email())
                .setPassword(request.password())
                .setDisplayName(request.displayName() == null ? "" : request.displayName())
                .build());
        return toDto(response);
    }

    @PostMapping("/login")
    public AuthResponseDto login(@RequestBody LoginRequestDto request, HttpServletRequest servletRequest) {
        requireCredentials(request.email(), request.password());
        AuthResponse response = rateLimits.login(servletRequest.getRemoteAddr(), request.email(),
                () -> authServiceStub.login(LoginRequest.newBuilder()
                        .setEmail(request.email())
                        .setPassword(request.password())
                        .build()));
        return toDto(response);
    }

    @PostMapping("/refresh")
    public AuthResponseDto refresh(@RequestBody RefreshRequestDto request) {
        AuthResponse response = authServiceStub.refresh(RefreshRequest.newBuilder()
                .setRefreshToken(request.refreshToken())
                .build());
        return toDto(response);
    }

    // 登出：作廢這個 refresh token 所在的那一串（auth-service 的 Logout）；不需要 access token，無效的 token 也回成功。
    @PostMapping("/logout")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void logout(@RequestBody RefreshRequestDto request) {
        authServiceStub.logout(LogoutRequest.newBuilder()
                .setRefreshToken(request.refreshToken() == null ? "" : request.refreshToken())
                .build());
    }

    // 登出所有裝置：作廢這位使用者所有的 refresh token。已簽出的 access token 仍有效到過期（最多 15 分鐘）。
    @PostMapping("/logout-all")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void logoutAllDevices(@CurrentUserId UUID userId) {
        GrpcMetadataSupport.withUserId(authServiceStub, userId)
                .logoutAllDevices(LogoutAllDevicesRequest.getDefaultInstance());
    }

    @GetMapping("/me")
    public UserDto me(@CurrentUserId UUID userId) {
        User user = GrpcMetadataSupport.withUserId(authServiceStub, userId)
                .getMe(GetMeRequest.newBuilder().build());
        return toDto(user);
    }

    // 沒給 email 或密碼：在限流與 gRPC 之前擋下（protobuf 的欄位不能是 null）。
    private static void requireCredentials(String email, String password) {
        if (email == null || password == null) {
            throw new IllegalArgumentException("email and password are required");
        }
    }

    private static AuthResponseDto toDto(AuthResponse response) {
        return new AuthResponseDto(response.getAccessToken(), response.getRefreshToken(), toDto(response.getUser()));
    }

    private static UserDto toDto(User user) {
        return new UserDto(user.getId(), user.getEmail(), user.getDisplayName(),
                GrpcTimestamps.toInstant(user.getCreatedAt()));
    }
}
