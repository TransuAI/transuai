package com.transuai.gateway.grpc;

import java.util.UUID;

import io.grpc.Metadata;
import io.grpc.stub.AbstractStub;
import io.grpc.stub.MetadataUtils;

/**
 * 每支需要身分的下游 rpc 都要帶 "x-user-id" metadata（見各服務的 UserIdServerInterceptor），
 * 這裡統一組裝，避免每個 controller method 重複同一段 Metadata/MetadataUtils 樣板。
 */
public final class GrpcMetadataSupport {

    private static final Metadata.Key<String> USER_ID_HEADER = Metadata.Key.of("x-user-id",
            Metadata.ASCII_STRING_MARSHALLER);

    private GrpcMetadataSupport() {
    }

    public static <S extends AbstractStub<S>> S withUserId(S stub, UUID userId) {
        Metadata metadata = new Metadata();
        metadata.put(USER_ID_HEADER, userId.toString());
        return stub.withInterceptors(MetadataUtils.newAttachHeadersInterceptor(metadata));
    }
}
