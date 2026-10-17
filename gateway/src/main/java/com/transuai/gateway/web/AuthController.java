package com.transuai.gateway.web;

import java.time.Instant;
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
import com.transuai.auth.grpc.v1.ChangePasswordRequest;
import com.transuai.auth.grpc.v1.DeleteAccountRequest;
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
import com.transuai.gateway.security.RevokedAccessTokens;
import com.transuai.gateway.web.dto.AuthResponseDto;
import com.transuai.gateway.web.dto.ChangePasswordRequestDto;
import com.transuai.gateway.web.dto.DeleteAccountRequestDto;
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
    private final RevokedAccessTokens revokedTokens;

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

    // 登出：作廢 cookie 裡這個 refresh token 所在的那一串（auth-service 的 Logout），那一串簽出的 access token 也馬上不能用，並清掉
    // cookie；不需要 access token，沒有 cookie 或 token 無效也回成功。
    @PostMapping("/logout")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void logout(HttpServletRequest servletRequest, HttpServletResponse servletResponse) {
        refreshTokenCookie.read(servletRequest).ifPresent(refreshToken -> {
            String sessionId = authServiceStub.logout(LogoutRequest.newBuilder().setRefreshToken(refreshToken).build())
                    .getSessionId();
            if (!sessionId.isEmpty()) {
                revokedTokens.sessionEnded(sessionId);
            }
        });
        refreshTokenCookie.clear(servletResponse);
    }

    // 登出所有裝置：作廢這位使用者所有的 refresh token，在這之前簽的 access token 也馬上不能用，並清掉這個瀏覽器的 cookie。
    @PostMapping("/logout-all")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void logoutAllDevices(@CurrentUserId UUID userId, HttpServletResponse servletResponse) {
        Instant now = Instant.now();
        GrpcMetadataSupport.withUserId(authServiceStub, userId)
                .logoutAllDevices(LogoutAllDevicesRequest.getDefaultInstance());
        revokedTokens.sessionsEndedBefore(userId, now);
        refreshTokenCookie.clear(servletResponse);
    }

    // 刪除帳號：再輸入一次密碼（錯了 403，連續錯太多次 429）。auth-service 刪掉使用者、發 account.deleted，其他服務清掉他的資料；
    // 這裡記住「剛刪掉」讓還沒過期的 access token 不能再用，並清掉這個瀏覽器的 refresh token cookie。
    @PostMapping("/account/delete")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteAccount(@CurrentUserId UUID userId, @RequestBody DeleteAccountRequestDto request,
            HttpServletResponse servletResponse) {
        if (request.password() == null || request.password().isEmpty()) {
            throw new IllegalArgumentException("password is required");
        }
        rateLimits.withPasswordCheck(userId, () -> GrpcMetadataSupport.withUserId(authServiceStub, userId)
                .deleteAccount(DeleteAccountRequest.newBuilder().setPassword(request.password()).build()));
        revokedTokens.userDeleted(userId);
        refreshTokenCookie.clear(servletResponse);
    }

    // 改密碼：要目前的密碼（錯了 403，跟刪除帳號合計連續錯太多次 429）。auth-service 作廢這位使用者所有的 refresh token，在這之前
    // 簽的 access token 也馬上不能用；這個瀏覽器拿到新的一組（cookie 換掉），其他裝置要重新登入。
    @PostMapping("/password")
    public AuthResponseDto changePassword(@CurrentUserId UUID userId, @RequestBody ChangePasswordRequestDto request,
            HttpServletResponse servletResponse) {
        if (request.currentPassword() == null || request.currentPassword().isEmpty() || request.newPassword() == null) {
            throw new IllegalArgumentException("currentPassword and newPassword are required");
        }
        // 取在呼叫之前：新簽的 token 在這之後，不會被擋。
        Instant now = Instant.now();
        AuthResponse response = rateLimits.withPasswordCheck(userId, () -> GrpcMetadataSupport.withUserId(authServiceStub, userId)
                .changePassword(ChangePasswordRequest.newBuilder()
                        .setCurrentPassword(request.currentPassword()).setNewPassword(request.newPassword()).build()));
        revokedTokens.sessionsEndedBefore(userId, now);
        return signedIn(response, servletResponse);
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
