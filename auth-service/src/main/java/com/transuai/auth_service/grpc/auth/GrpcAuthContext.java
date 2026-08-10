package com.transuai.auth_service.grpc.auth;

import java.util.UUID;

import io.grpc.Context;
import io.grpc.Status;

public final class GrpcAuthContext {

    static final Context.Key<UUID> USER_ID = Context.key("userId");

    private GrpcAuthContext() {
    }

    // 由 UserIdServerInterceptor 從 "x-user-id" metadata 寫入 Context，
    // GetMe 呼叫這裡取得目前呼叫者身分。
    public static UUID currentUserId() {
        UUID userId = USER_ID.get();
        if (userId == null) {
            throw Status.UNAUTHENTICATED.withDescription("missing x-user-id metadata").asRuntimeException();
        }
        return userId;
    }
}
