package com.transuai.auth_service.grpc.auth;

import java.util.Set;
import java.util.UUID;

import org.springframework.grpc.server.GlobalServerInterceptor;
import org.springframework.stereotype.Component;

import io.grpc.Context;
import io.grpc.Contexts;
import io.grpc.Metadata;
import io.grpc.ServerCall;
import io.grpc.ServerCallHandler;
import io.grpc.ServerInterceptor;
import io.grpc.Status;

/**
 * AuthService 是 Gateway 唯一會在使用者還沒有 token 之前呼叫的服務（Register/Login/Refresh），
 * 所以跟 upload-service 的 UserIdServerInterceptor 不同：這裡不能整個 service 一起豁免，
 * 只有 Register/Login/Refresh/Logout 這四支不需要 "x-user-id"（Logout 靠 refresh token 本身）；GetMe、LogoutAllDevices
 * 已經是「使用者已登入」的操作，
 * 一樣信任 Gateway 驗證 JWT 後轉發過來的 "x-user-id"，不重新驗證 JWT。
 *
 * grpc.health.v1.Health / grpc.reflection.v1.ServerReflection 是基礎設施用的內建服務，不需要身分。
 */
@Component
@GlobalServerInterceptor
public class UserIdServerInterceptor implements ServerInterceptor {

    static final Metadata.Key<String> USER_ID_HEADER = Metadata.Key.of("x-user-id",
            Metadata.ASCII_STRING_MARSHALLER);

    private static final Set<String> UNAUTHENTICATED_SERVICES = Set.of(
            "grpc.health.v1.Health",
            "grpc.reflection.v1.ServerReflection",
            "grpc.reflection.v1alpha.ServerReflection");

    private static final Set<String> UNAUTHENTICATED_METHODS = Set.of(
            "transuai.auth.v1.AuthService/Register",
            "transuai.auth.v1.AuthService/Login",
            "transuai.auth.v1.AuthService/Refresh",
            "transuai.auth.v1.AuthService/Logout",
            "transuai.auth.v1.AuthService/RequestPasswordReset",
            "transuai.auth.v1.AuthService/ResetPassword",
            "transuai.auth.v1.AuthService/VerifyEmail",
            "transuai.auth.v1.AuthService/ResetPasswordWithRecoveryCode",
            "transuai.auth.v1.AuthService/GetSystemStatus");

    @Override
    public <ReqT, RespT> ServerCall.Listener<ReqT> interceptCall(ServerCall<ReqT, RespT> call, Metadata headers,
            ServerCallHandler<ReqT, RespT> next) {
        String fullMethodName = call.getMethodDescriptor().getFullMethodName();
        if (UNAUTHENTICATED_SERVICES.contains(call.getMethodDescriptor().getServiceName())
                || UNAUTHENTICATED_METHODS.contains(fullMethodName)) {
            return next.startCall(call, headers);
        }

        String rawUserId = headers.get(USER_ID_HEADER);
        if (rawUserId == null || rawUserId.isBlank()) {
            call.close(Status.UNAUTHENTICATED.withDescription("missing x-user-id metadata"), headers);
            return new ServerCall.Listener<>() {
            };
        }

        UUID userId;
        try {
            userId = UUID.fromString(rawUserId);
        } catch (IllegalArgumentException e) {
            call.close(Status.UNAUTHENTICATED.withDescription("invalid x-user-id metadata"), headers);
            return new ServerCall.Listener<>() {
            };
        }

        Context context = Context.current().withValue(GrpcAuthContext.USER_ID, userId);
        return Contexts.interceptCall(context, call, headers, next);
    }
}
