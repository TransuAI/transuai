package com.transuai.gateway.grpc;

import java.time.Instant;

import com.google.protobuf.Timestamp;

public final class GrpcTimestamps {

    private GrpcTimestamps() {
    }

    public static Instant toInstant(Timestamp timestamp) {
        return Instant.ofEpochSecond(timestamp.getSeconds(), timestamp.getNanos());
    }
}
