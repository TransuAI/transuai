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
import com.transuai.gateway.security.RefreshTokenCookie;
import com.transuai.gateway.web.dto.AuthResponseDto;
import com.transuai.gateway.web.dto.LoginRequestDto;
import com.transuai.gateway.web.dto.RegisterRequestDto;
import com.transuai.gateway.web.dto.UserDto;

import io.grpc.Status;
import io.grpc.StatusRuntimeException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import lombok.RequiredArgsConstructor;

// 對應 ../../architecture-design.md 3.1（原文件用 Spring Boot + Spring Security 直接做 Auth Service 的
// REST API；這裡 Auth Service 本身只講 gRPC，REST 是這個 Gateway 轉出來的，跟平台其他服務一致）。
@RestController
@RequestMapping("/auth")
@RequiredArgsConstructor
public class AuthController {

    private final AuthServiceGrpc.AuthServiceBlockingStub authServiceStub;
    private final AuthRateLimits rateLimits;
    private final RefreshTokenCookie refreshTokenCookie;

    // 限流用的 IP 是 getRemoteAddr()，預設就是直接連進來的位址（不看使用者可以自己填的 X-Forwarded-For；在反向代理後面時
    // 怎麼設定見 gateway README「限流」）。
    @PostMapping("/register")
    public AuthResponseDto register(@RequestBody RegisterRequestDto request, HttpServletRequest servletRequest,
            HttpServletResponse servletResponse) {
        requireCredentials(request.email(), request.password());
        rateLimits.beforeRegister(servletRequest.getRemoteAddr());
        AuthResponse response = authServiceStub.register(RegisterRequest.newBuilder()
                .setEmail(request.email())
                .setPassword(request.password())
                .setDisplayName(request.displayName() == null ? "" : request.displayName())
                .build());
        return signedIn(response, servletResponse);
    }

    @PostMapping("/login")
    public AuthResponseDto login(@RequestBody LoginRequestDto request, HttpServletRequest servletRequest,
            HttpServletResponse servletResponse) {
        requireCredentials(request.email(), request.password());
        AuthResponse response = rateLimits.login(servletRequest.getRemoteAddr(), request.email(),
                () -> authServiceStub.login(LoginRequest.newBuilder()
                        .setEmail(request.email())
                        .setPassword(request.password())
                        .build()));
        return signedIn(response, servletResponse);
    }

    // 用 cookie 裡的 refresh token 換新的 access token，cookie 換成輪替後的新 refresh token。前端重新整理頁面時也靠這個恢復登入。
    // 沒有 cookie、或 auth-service 不認（過期、作廢、被盜）：清掉 cookie，回 401。
    @PostMapping("/refresh")
    public AuthResponseDto refresh(HttpServletRequest servletRequest, HttpServletResponse servletResponse) {
        String refreshToken = refreshTokenCookie.read(servletRequest)
                .orElseThrow(() -> Status.UNAUTHENTICATED.withDescription("not signed in").asRuntimeException());
        AuthResponse response;
        try {
            response = authServiceStub.refresh(RefreshRequest.newBuilder().setRefreshToken(refreshToken).build());
        } catch (StatusRuntimeException e) {
            if (e.getStatus().getCode() == Status.Code.UNAUTHENTICATED) {
                refreshTokenCookie.clear(servletResponse);
            }
            throw e;
        }
        return signedIn(response, servletResponse);
    }

    // 登出：作廢 cookie 裡這個 refresh token 所在的那一串（auth-service 的 Logout），並清掉 cookie；不需要 access token，
    // 沒有 cookie 或 token 無效也回成功。
    @PostMapping("/logout")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void logout(HttpServletRequest servletRequest, HttpServletResponse servletResponse) {
        refreshTokenCookie.read(servletRequest).ifPresent(refreshToken -> authServiceStub.logout(
                LogoutRequest.newBuilder().setRefreshToken(refreshToken).build()));
        refreshTokenCookie.clear(servletResponse);
    }

    // 登出所有裝置：作廢這位使用者所有的 refresh token，並清掉這個瀏覽器的 cookie。已簽出的 access token 仍有效到過期（最多 15 分鐘）。
    @PostMapping("/logout-all")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void logoutAllDevices(@CurrentUserId UUID userId, HttpServletResponse servletResponse) {
        GrpcMetadataSupport.withUserId(authServiceStub, userId)
                .logoutAllDevices(LogoutAllDevicesRequest.getDefaultInstance());
        refreshTokenCookie.clear(servletResponse);
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

    // refresh token 放進 cookie，回應本文只有 access token 與使用者。
    private AuthResponseDto signedIn(AuthResponse response, HttpServletResponse servletResponse) {
        refreshTokenCookie.set(servletResponse, response.getRefreshToken());
        return new AuthResponseDto(response.getAccessToken(), toDto(response.getUser()));
    }

    private static UserDto toDto(User user) {
        return new UserDto(user.getId(), user.getEmail(), user.getDisplayName(),
                GrpcTimestamps.toInstant(user.getCreatedAt()));
    }
}
