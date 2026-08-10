package com.transuai.auth_service.grpc;

import java.time.Instant;
import java.time.OffsetDateTime;

import com.google.protobuf.Timestamp;

public final class GrpcTimestamps {

    private GrpcTimestamps() {
    }

    public static Timestamp toProto(Instant instant) {
        return Timestamp.newBuilder()
                .setSeconds(instant.getEpochSecond())
                .setNanos(instant.getNano())
                .build();
    }

    public static Timestamp toProto(OffsetDateTime dateTime) {
        return toProto(dateTime.toInstant());
    }
}
