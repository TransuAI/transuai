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
import com.transuai.auth.grpc.v1.ChangePasswordResponse;
import com.transuai.auth.grpc.v1.DeleteAccountRequest;
import com.transuai.auth.grpc.v1.GetMeRequest;
import com.transuai.auth.grpc.v1.LoginRequest;
import com.transuai.auth.grpc.v1.LogoutAllDevicesRequest;
import com.transuai.auth.grpc.v1.LogoutRequest;
import com.transuai.auth.grpc.v1.RefreshRequest;
import com.transuai.auth.grpc.v1.GenerateRecoveryCodesRequest;
import com.transuai.auth.grpc.v1.RegisterRequest;
import com.transuai.auth.grpc.v1.RequestPasswordResetRequest;
import com.transuai.auth.grpc.v1.ResendEmailVerificationRequest;
import com.transuai.auth.grpc.v1.ResetPasswordRequest;
import com.transuai.auth.grpc.v1.ResetPasswordResponse;
import com.transuai.auth.grpc.v1.ResetPasswordWithRecoveryCodeRequest;
import com.transuai.auth.grpc.v1.User;
import com.transuai.auth.grpc.v1.VerifyEmailRequest;
import com.transuai.gateway.grpc.GrpcMetadataSupport;
import com.transuai.gateway.grpc.GrpcTimestamps;
import com.transuai.gateway.ratelimit.AuthRateLimits;
import com.transuai.gateway.security.RefreshTokenCookie;
import com.transuai.gateway.security.RevokedAccessTokens;
import com.transuai.gateway.web.dto.AuthResponseDto;
import com.transuai.gateway.web.dto.ChangePasswordRequestDto;
import com.transuai.gateway.web.dto.DeleteAccountRequestDto;
import com.transuai.gateway.web.dto.LoginRequestDto;
import com.transuai.gateway.web.dto.PasswordResetConfirmDto;
import com.transuai.gateway.web.dto.PasswordResetRequestDto;
import com.transuai.gateway.web.dto.RecoveryCodeResetDto;
import com.transuai.gateway.web.dto.RecoveryCodesDto;
import com.transuai.gateway.web.dto.RecoveryCodesRequestDto;
import com.transuai.gateway.web.dto.RegisterRequestDto;
import com.transuai.gateway.web.dto.UserDto;
import com.transuai.gateway.web.dto.VerifyEmailDto;

import io.grpc.Status;
import io.grpc.StatusRuntimeException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;

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
    public AuthResponseDto register(@Valid @RequestBody RegisterRequestDto request, HttpServletRequest servletRequest,
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
    public AuthResponseDto login(@Valid @RequestBody LoginRequestDto request, HttpServletRequest servletRequest,
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
        GrpcMetadataSupport.withUserId(authServiceStub, userId)
                .logoutAllDevices(LogoutAllDevicesRequest.getDefaultInstance())
                .getEndedSessionIdsList().forEach(revokedTokens::sessionEnded);
        revokedTokens.legacySessionsEndedBefore(userId, Instant.now());
        refreshTokenCookie.clear(servletResponse);
    }

    // 刪除帳號：再輸入一次密碼（錯了 403，連續錯太多次 429）。auth-service 刪掉使用者、發 account.deleted，其他服務清掉他的資料；
    // 這裡記住「剛刪掉」讓還沒過期的 access token 不能再用，並清掉這個瀏覽器的 refresh token cookie。
    @PostMapping("/account/delete")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteAccount(@CurrentUserId UUID userId, @Valid @RequestBody DeleteAccountRequestDto request,
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
    public AuthResponseDto changePassword(@CurrentUserId UUID userId, @Valid @RequestBody ChangePasswordRequestDto request,
            HttpServletResponse servletResponse) {
        if (request.currentPassword() == null || request.currentPassword().isEmpty() || request.newPassword() == null) {
            throw new IllegalArgumentException("currentPassword and newPassword are required");
        }
        ChangePasswordResponse response = rateLimits.withPasswordCheck(userId, () -> GrpcMetadataSupport.withUserId(authServiceStub, userId)
                .changePassword(ChangePasswordRequest.newBuilder()
                        .setCurrentPassword(request.currentPassword()).setNewPassword(request.newPassword()).build()));
        response.getEndedSessionIdsList().forEach(revokedTokens::sessionEnded);
        revokedTokens.legacySessionsEndedBefore(userId, Instant.now());
        return signedIn(response.getSignedIn(), servletResponse);
    }

    // 忘記密碼：email 有註冊就寄重設連結（auth-service），沒註冊也一樣回 202，不透露有沒有這個帳號。這個部署沒設定寄信時 503。
    @PostMapping("/password-reset")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public void requestPasswordReset(@Valid @RequestBody PasswordResetRequestDto request, HttpServletRequest servletRequest) {
        if (request.email() == null || request.email().isBlank()) {
            throw new IllegalArgumentException("email is required");
        }
        rateLimits.beforePasswordReset(servletRequest.getRemoteAddr(), request.email());
        authServiceStub.requestPasswordReset(RequestPasswordResetRequest.newBuilder().setEmail(request.email()).build());
    }

    // 用重設連結設新密碼：成功 204（前端請使用者用新密碼登入）；這位使用者其他的登入全部作廢，access token 也馬上不能用。
    // 連結無效或過期 409、新密碼不合規則 400。
    @PostMapping("/password-reset/confirm")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void resetPassword(@Valid @RequestBody PasswordResetConfirmDto request, HttpServletRequest servletRequest) {
        if (request.token() == null || request.token().isBlank() || request.newPassword() == null) {
            throw new IllegalArgumentException("token and newPassword are required");
        }
        rateLimits.beforePasswordResetConfirm(servletRequest.getRemoteAddr());
        ResetPasswordResponse response = authServiceStub.resetPassword(ResetPasswordRequest.newBuilder()
                .setToken(request.token()).setNewPassword(request.newPassword()).build());
        response.getEndedSessionIdsList().forEach(revokedTokens::sessionEnded);
        revokedTokens.legacySessionsEndedBefore(UUID.fromString(response.getUserId()), Instant.now());
    }

    // 確認 email：註冊時寄的連結裡的 token，不用登入。無效或過期 409。
    @PostMapping("/verify-email")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void verifyEmail(@Valid @RequestBody VerifyEmailDto request, HttpServletRequest servletRequest) {
        if (request.token() == null || request.token().isBlank()) {
            throw new IllegalArgumentException("token is required");
        }
        rateLimits.beforePasswordResetConfirm(servletRequest.getRemoteAddr());
        authServiceStub.verifyEmail(VerifyEmailRequest.newBuilder().setToken(request.token()).build());
    }

    // 重寄確認信（要登入）：已經確認過就什麼都不做；跟申請重設密碼一樣，每個 email 每小時有上限。沒有設定寄信 503。
    @PostMapping("/verify-email/resend")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public void resendEmailVerification(@CurrentUserId UUID userId) {
        rateLimits.beforeMailTo("user:" + userId);
        GrpcMetadataSupport.withUserId(authServiceStub, userId)
                .resendEmailVerification(ResendEmailVerificationRequest.getDefaultInstance());
    }

    // 產生復原碼（要登入、要目前的密碼；錯了 403，跟刪除帳號、改密碼合計 15 分鐘 5 次）。回傳 10 組，只有這一次看得到。
    @PostMapping("/recovery-codes")
    public RecoveryCodesDto generateRecoveryCodes(@CurrentUserId UUID userId, @Valid @RequestBody RecoveryCodesRequestDto request) {
        if (request.currentPassword() == null || request.currentPassword().isEmpty()) {
            throw new IllegalArgumentException("currentPassword is required");
        }
        return new RecoveryCodesDto(rateLimits.withPasswordCheck(userId, () -> GrpcMetadataSupport.withUserId(authServiceStub, userId)
                .generateRecoveryCodes(GenerateRecoveryCodesRequest.newBuilder()
                        .setCurrentPassword(request.currentPassword()).build()))
                .getCodesList());
    }

    // 忘記密碼的另一條路：email＋一組復原碼設新密碼，不用登入。猜錯（409）跟登入失敗一樣，同一個 IP 對同一個 email 15 分鐘 5 次；
    // 成功 204，這位使用者所有的登入作廢、access token 馬上不能用。
    @PostMapping("/password-reset/recovery-code")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void resetPasswordWithRecoveryCode(@Valid @RequestBody RecoveryCodeResetDto request,
            HttpServletRequest servletRequest) {
        if (request.email() == null || request.code() == null || request.newPassword() == null) {
            throw new IllegalArgumentException("email, code and newPassword are required");
        }
        ResetPasswordResponse response = rateLimits.withRecoveryCode(servletRequest.getRemoteAddr(), request.email(),
                () -> authServiceStub.resetPasswordWithRecoveryCode(ResetPasswordWithRecoveryCodeRequest.newBuilder()
                        .setEmail(request.email()).setCode(request.code()).setNewPassword(request.newPassword()).build()));
        response.getEndedSessionIdsList().forEach(revokedTokens::sessionEnded);
        revokedTokens.legacySessionsEndedBefore(UUID.fromString(response.getUserId()), Instant.now());
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
                GrpcTimestamps.toInstant(user.getCreatedAt()), user.getEmailVerified(), user.getRecoveryCodesLeft());
    }
}
