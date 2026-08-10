package com.transuai.auth_service.grpc;

import java.util.UUID;

import org.springframework.grpc.server.service.GrpcService;
import org.springframework.security.crypto.password.PasswordEncoder;

import com.transuai.auth.grpc.v1.AuthResponse;
import com.transuai.auth.grpc.v1.AuthServiceGrpc;
import com.transuai.auth.grpc.v1.GetMeRequest;
import com.transuai.auth.grpc.v1.LoginRequest;
import com.transuai.auth.grpc.v1.RefreshRequest;
import com.transuai.auth.grpc.v1.RegisterRequest;
import com.transuai.auth.grpc.v1.User;
import com.transuai.auth_service.grpc.auth.GrpcAuthContext;
import com.transuai.auth_service.repository.UserRepository;
import com.transuai.auth_service.security.JwtService;

import io.grpc.Status;
import io.grpc.stub.StreamObserver;
import lombok.RequiredArgsConstructor;

@GrpcService
@RequiredArgsConstructor
public class AuthGrpcService extends AuthServiceGrpc.AuthServiceImplBase {

    private static final int MIN_PASSWORD_LENGTH = 8;

    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final JwtService jwtService;

    @Override
    public void register(RegisterRequest request, StreamObserver<AuthResponse> responseObserver) {
        String email = request.getEmail().trim().toLowerCase();
        if (email.isBlank() || !email.contains("@")) {
            responseObserver.onError(Status.INVALID_ARGUMENT
                    .withDescription("email must be a valid email address").asRuntimeException());
            return;
        }
        if (request.getPassword().length() < MIN_PASSWORD_LENGTH) {
            responseObserver.onError(Status.INVALID_ARGUMENT
                    .withDescription("password must be at least " + MIN_PASSWORD_LENGTH + " characters")
                    .asRuntimeException());
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

        responseObserver.onNext(buildAuthResponse(user));
        responseObserver.onCompleted();
    }

    @Override
    public void login(LoginRequest request, StreamObserver<AuthResponse> responseObserver) {
        String email = request.getEmail().trim().toLowerCase();
        com.transuai.auth_service.domain.User user = userRepository.findByEmail(email).orElse(null);
        // 帳號不存在跟密碼錯誤回同一種錯誤，避免帳號列舉。
        if (user == null || !passwordEncoder.matches(request.getPassword(), user.getPasswordHash())) {
            responseObserver.onError(
                    Status.UNAUTHENTICATED.withDescription("invalid email or password").asRuntimeException());
            return;
        }

        responseObserver.onNext(buildAuthResponse(user));
        responseObserver.onCompleted();
    }

    @Override
    public void refresh(RefreshRequest request, StreamObserver<AuthResponse> responseObserver) {
        UUID userId = jwtService.parseRefreshToken(request.getRefreshToken());
        com.transuai.auth_service.domain.User user = userRepository.findById(userId).orElse(null);
        if (user == null) {
            responseObserver.onError(
                    Status.UNAUTHENTICATED.withDescription("user no longer exists").asRuntimeException());
            return;
        }

        responseObserver.onNext(buildAuthResponse(user));
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

    private AuthResponse buildAuthResponse(com.transuai.auth_service.domain.User user) {
        JwtService.IssuedTokens tokens = jwtService.issueTokens(user.getId(), user.getEmail());
        return AuthResponse.newBuilder()
                .setAccessToken(tokens.accessToken())
                .setRefreshToken(tokens.refreshToken())
                .setUser(UserMapper.toProto(user))
                .build();
    }
}
