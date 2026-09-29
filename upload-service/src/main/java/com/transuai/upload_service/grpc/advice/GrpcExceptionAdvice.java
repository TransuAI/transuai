package com.transuai.upload_service.grpc.advice;

import org.springframework.amqp.AmqpException;
import org.springframework.dao.DataAccessException;
import org.springframework.grpc.server.advice.GrpcAdvice;
import org.springframework.grpc.server.advice.GrpcExceptionHandler;

import io.grpc.Status;
import io.grpc.StatusRuntimeException;
import lombok.extern.slf4j.Slf4j;
import software.amazon.awssdk.core.exception.SdkException;

/**
 * 業務驗證錯誤（INVALID_ARGUMENT / NOT_FOUND / PERMISSION_DENIED / ...）已經在各 rpc
 * 實作內直接送出對應的 {@link Status}，gRPC runtime 本身就會正確處理，不需要這裡介入。
 * <p>
 * 這裡只攔截「非預期的基礎設施例外」，避免內部細節（stack trace、SQL 訊息等）外洩給呼叫端，
 * 並統一記 log 方便追查。{@code Status#withCause} 只會留在伺服器端做本地記錄／鏈結，
 * 不會透過 gRPC wire 傳給呼叫端。
 */
@GrpcAdvice
@Slf4j
public class GrpcExceptionAdvice {

    @GrpcExceptionHandler(DataAccessException.class)
    public Status handleDataAccessException(DataAccessException e) {
        log.error("database error while handling gRPC call", e);
        return Status.INTERNAL.withDescription("internal database error").withCause(e);
    }

    @GrpcExceptionHandler(SdkException.class)
    public Status handleStorageException(SdkException e) {
        log.error("object storage error while handling gRPC call", e);
        return Status.UNAVAILABLE.withDescription("object storage temporarily unavailable").withCause(e);
    }

    @GrpcExceptionHandler(AmqpException.class)
    public Status handleAmqpException(AmqpException e) {
        log.error("message queue error while handling gRPC call", e);
        return Status.UNAVAILABLE.withDescription("message queue temporarily unavailable").withCause(e);
    }

    // A status the code chose on purpose (e.g. INVALID_ARGUMENT for a bad job_id, NOT_FOUND for an unknown job) goes back as
    // it is; without this the catch-all below would turn it into INTERNAL.
    @GrpcExceptionHandler(StatusRuntimeException.class)
    public Status handleStatus(StatusRuntimeException e) {
        return e.getStatus();
    }

    @GrpcExceptionHandler(Exception.class)
    public Status handleUnexpected(Exception e) {
        log.error("unexpected error while handling gRPC call", e);
        return Status.INTERNAL.withDescription("unexpected server error").withCause(e);
    }
}
