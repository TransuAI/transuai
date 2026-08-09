package com.transuai.upload_service.grpc.auth;

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
 * UploadService 是純內部服務：身分驗證（JWT）由 API Gateway 負責，
 * Gateway 驗證後把 user id 透過 "x-user-id" gRPC metadata 轉發過來，
 * 這裡只信任該 header、不重新驗證 JWT。
 *
 * grpc.health.v1.Health / grpc.reflection.v1.ServerReflection 是基礎設施用的內建服務
 * （health check、grpcurl 除錯），不需要身分即可呼叫。
 *
 * transuai.upload.v1.InternalJobService 是服務間（pipeline 下游）回呼用的內部 service，
 * 呼叫方只有 job_id、沒有終端使用者身分，因此整個服務豁免——與 x-user-id 本身「只信任內部網路」
 * 的設計前提一致，不另外加共享密鑰。
 */
@Component
@GlobalServerInterceptor
public class UserIdServerInterceptor implements ServerInterceptor {

    static final Metadata.Key<String> USER_ID_HEADER = Metadata.Key.of("x-user-id",
            Metadata.ASCII_STRING_MARSHALLER);

    private static final Set<String> UNAUTHENTICATED_SERVICES = Set.of(
            "grpc.health.v1.Health",
            "grpc.reflection.v1.ServerReflection",
            "grpc.reflection.v1alpha.ServerReflection",
            "transuai.upload.v1.InternalJobService");

    @Override
    public <ReqT, RespT> ServerCall.Listener<ReqT> interceptCall(ServerCall<ReqT, RespT> call, Metadata headers,
            ServerCallHandler<ReqT, RespT> next) {
        if (UNAUTHENTICATED_SERVICES.contains(call.getMethodDescriptor().getServiceName())) {
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
