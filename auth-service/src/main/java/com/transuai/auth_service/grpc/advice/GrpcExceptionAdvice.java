package com.transuai.auth_service.grpc.advice;

import org.springframework.dao.DataAccessException;
import org.springframework.grpc.server.advice.GrpcAdvice;
import org.springframework.grpc.server.advice.GrpcExceptionHandler;

import io.grpc.Status;
import io.grpc.StatusException;
import io.grpc.StatusRuntimeException;
import lombok.extern.slf4j.Slf4j;

/**
 * 業務驗證錯誤大多在各 rpc 實作內直接呼叫 responseObserver.onError() 送出對應的 {@link Status}，
 * 不會流經這裡。但像 JwtService.parseRefreshToken 這種共用邏輯是直接 throw
 * Status.xxx().asRuntimeException()（呼叫點不只一處，用 onError 沒辦法共用），這種例外一樣要
 * 原樣放行，不能被下面的 Exception 這個 catch-all 吃掉、降級成 INTERNAL。
 */
@GrpcAdvice
@Slf4j
public class GrpcExceptionAdvice {

    @GrpcExceptionHandler(StatusRuntimeException.class)
    public Status handleStatusRuntimeException(StatusRuntimeException e) {
        return e.getStatus();
    }

    @GrpcExceptionHandler(StatusException.class)
    public Status handleStatusException(StatusException e) {
        return e.getStatus();
    }

    @GrpcExceptionHandler(DataAccessException.class)
    public Status handleDataAccessException(DataAccessException e) {
        log.error("database error while handling gRPC call", e);
        return Status.INTERNAL.withDescription("internal database error").withCause(e);
    }

    @GrpcExceptionHandler(Exception.class)
    public Status handleUnexpected(Exception e) {
        log.error("unexpected error while handling gRPC call", e);
        return Status.INTERNAL.withDescription("unexpected server error").withCause(e);
    }
}
