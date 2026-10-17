package com.transuai.auth_service.grpc;

import java.util.Locale;
import java.util.UUID;

import org.springframework.grpc.server.service.GrpcService;
import org.springframework.security.crypto.password.PasswordEncoder;

import com.transuai.auth.grpc.v1.AuthResponse;
import com.transuai.auth.grpc.v1.AuthServiceGrpc;
import com.transuai.auth.grpc.v1.DeleteAccountRequest;
import com.transuai.auth.grpc.v1.DeleteAccountResponse;
import com.transuai.auth.grpc.v1.GetMeRequest;
import com.transuai.auth.grpc.v1.LoginRequest;
import com.transuai.auth.grpc.v1.LogoutAllDevicesRequest;
import com.transuai.auth.grpc.v1.LogoutRequest;
import com.transuai.auth.grpc.v1.LogoutResponse;
import com.transuai.auth.grpc.v1.RefreshRequest;
import com.transuai.auth.grpc.v1.RegisterRequest;
import com.transuai.auth.grpc.v1.User;
import com.transuai.auth_service.grpc.auth.GrpcAuthContext;
import com.transuai.auth_service.repository.UserRepository;
import com.transuai.auth_service.security.JwtService;
import com.transuai.auth_service.security.RefreshTokens;
import com.transuai.auth_service.service.AccountDeletion;

import io.grpc.Status;
import io.grpc.stub.StreamObserver;
import lombok.RequiredArgsConstructor;

@GrpcService
@RequiredArgsConstructor
public class AuthGrpcService extends AuthServiceGrpc.AuthServiceImplBase {

    // ASVS 2.1.1、2.1.2：至少 12 字元，最多 128 字元（以字元算，中文與 emoji 一個算一個）；不限制要有哪些種類的字元。
    private static final int MIN_PASSWORD_LENGTH = 12;
    private static final int MAX_PASSWORD_LENGTH = 128;

    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final JwtService jwtService;
    private final RefreshTokens refreshTokens;
    private final AccountDeletion accountDeletion;
    // 帳號不存在時也拿密碼比對這個雜湊，回應時間才跟「密碼錯」一樣長，不能用來猜哪些 email 註冊過。第一次用到才產生
    // （跟真的密碼用同一個 encoder、同樣的成本）。
    private volatile String unknownUserHash;

    @Override
    public void register(RegisterRequest request, StreamObserver<AuthResponse> responseObserver) {
        String email = request.getEmail().trim().toLowerCase(Locale.ROOT);
        if (email.isBlank() || !email.contains("@")) {
            responseObserver.onError(Status.INVALID_ARGUMENT
                    .withDescription("email must be a valid email address").asRuntimeException());
            return;
        }
        int passwordLength = request.getPassword().codePointCount(0, request.getPassword().length());
        if (passwordLength < MIN_PASSWORD_LENGTH) {
            responseObserver.onError(Status.INVALID_ARGUMENT
                    .withDescription("密碼至少要 " + MIN_PASSWORD_LENGTH + " 個字元").asRuntimeException());
            return;
        }
        if (passwordLength > MAX_PASSWORD_LENGTH) {
            responseObserver.onError(Status.INVALID_ARGUMENT
                    .withDescription("密碼最多 " + MAX_PASSWORD_LENGTH + " 個字元").asRuntimeException());
            return;
        }
        if (userRepository.existsByEmail(email)) {
            responseObserver.onError(
                    Status.ALREADY_EXISTS.withDescription("email already registered").asRuntimeException());
            return;
        }

        com.transuai.auth_service.domain.User user = com.transuai.auth_service.domain.User.builder()
                .email(email)
                .passwordHash(passwordEncoder.encode(request.getPassword()))
                .displayName(request.getDisplayName().isBlank() ? null : request.getDisplayName())
                .build();
        user = userRepository.save(user);

        responseObserver.onNext(buildAuthResponse(user, refreshTokens.issue(user.getId())));
        responseObserver.onCompleted();
    }

    @Override
    public void login(LoginRequest request, StreamObserver<AuthResponse> responseObserver) {
        String email = request.getEmail().trim().toLowerCase(Locale.ROOT);
        com.transuai.auth_service.domain.User user = userRepository.findByEmail(email).orElse(null);
        // 帳號不存在跟密碼錯誤回同一種錯誤、花一樣的時間，避免帳號列舉。
        String hash = user == null ? unknownUserHash() : user.getPasswordHash();
        if (!passwordEncoder.matches(request.getPassword(), hash) || user == null) {
            responseObserver.onError(
                    Status.UNAUTHENTICATED.withDescription("invalid email or password").asRuntimeException());
            return;
        }
        // 舊的 bcrypt 雜湊：密碼對了，順便換成現在的雜湊方式。
        if (passwordEncoder.upgradeEncoding(hash)) {
            user.setPasswordHash(passwordEncoder.encode(request.getPassword()));
            user = userRepository.save(user);
        }

        responseObserver.onNext(buildAuthResponse(user, refreshTokens.issue(user.getId())));
        responseObserver.onCompleted();
    }

    @Override
    public void refresh(RefreshRequest request, StreamObserver<AuthResponse> responseObserver) {
        RefreshTokens.Exchange exchange = refreshTokens.exchange(request.getRefreshToken());
        com.transuai.auth_service.domain.User user = userRepository.findById(exchange.userId()).orElse(null);
        if (user == null) {
            responseObserver.onError(
                    Status.UNAUTHENTICATED.withDescription("user no longer exists").asRuntimeException());
            return;
        }

        responseObserver.onNext(buildAuthResponse(user, exchange.refreshToken()));
        responseObserver.onCompleted();
    }

    @Override
    public void logout(LogoutRequest request, StreamObserver<LogoutResponse> responseObserver) {
        refreshTokens.logout(request.getRefreshToken());
        responseObserver.onNext(LogoutResponse.getDefaultInstance());
        responseObserver.onCompleted();
    }

    @Override
    public void logoutAllDevices(LogoutAllDevicesRequest request, StreamObserver<LogoutResponse> responseObserver) {
        refreshTokens.logoutAll(GrpcAuthContext.currentUserId());
        responseObserver.onNext(LogoutResponse.getDefaultInstance());
        responseObserver.onCompleted();
    }

    // 刪除帳號前再確認一次密碼：開著的瀏覽器被別人拿到也刪不掉帳號。密碼錯是 PERMISSION_DENIED（Gateway 回 403），不是
    // UNAUTHENTICATED——那會讓前端以為 token 過期、去換發再重試。
    @Override
    public void deleteAccount(DeleteAccountRequest request, StreamObserver<DeleteAccountResponse> responseObserver) {
        UUID userId = GrpcAuthContext.currentUserId();
        com.transuai.auth_service.domain.User user = userRepository.findById(userId).orElse(null);
        if (user == null) {
            responseObserver.onError(Status.NOT_FOUND.withDescription("user not found").asRuntimeException());
            return;
        }
        if (!passwordEncoder.matches(request.getPassword(), user.getPasswordHash())) {
            responseObserver.onError(
                    Status.PERMISSION_DENIED.withDescription("wrong password").asRuntimeException());
            return;
        }

        accountDeletion.delete(userId);
        responseObserver.onNext(DeleteAccountResponse.getDefaultInstance());
        responseObserver.onCompleted();
    }

    @Override
    public void getMe(GetMeRequest request, StreamObserver<User> responseObserver) {
        UUID userId = GrpcAuthContext.currentUserId();
        com.transuai.auth_service.domain.User user = userRepository.findById(userId).orElse(null);
        if (user == null) {
            responseObserver.onError(Status.NOT_FOUND.withDescription("user not found").asRuntimeException());
            return;
        }

        responseObserver.onNext(UserMapper.toProto(user));
        responseObserver.onCompleted();
    }

    private String unknownUserHash() {
        if (unknownUserHash == null) {
            unknownUserHash = passwordEncoder.encode(UUID.randomUUID().toString());
        }
        return unknownUserHash;
    }

    private AuthResponse buildAuthResponse(com.transuai.auth_service.domain.User user, String refreshToken) {
        return AuthResponse.newBuilder()
                .setAccessToken(jwtService.issueAccessToken(user.getId(), user.getEmail()))
                .setRefreshToken(refreshToken)
                .setUser(UserMapper.toProto(user))
                .build();
    }
}
