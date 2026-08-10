package com.transuai.gateway.web.advice;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import com.transuai.gateway.web.dto.ErrorResponse;

import io.grpc.Status;
import io.grpc.StatusRuntimeException;
import lombok.extern.slf4j.Slf4j;

/**
 * 每個下游服務都是純 gRPC，controller 直接呼叫 blocking stub、讓 StatusRuntimeException
 * 往外拋，統一在這裡轉成前端看得懂的 HTTP status + JSON body，controller 本身不用重複 try/catch。
 */
@RestControllerAdvice
@Slf4j
public class GrpcExceptionAdvice {

    @ExceptionHandler(StatusRuntimeException.class)
    public ResponseEntity<ErrorResponse> handleGrpcStatus(StatusRuntimeException e) {
        Status status = e.getStatus();
        HttpStatus httpStatus = switch (status.getCode()) {
            case INVALID_ARGUMENT -> HttpStatus.BAD_REQUEST;
            case UNAUTHENTICATED -> HttpStatus.UNAUTHORIZED;
            case PERMISSION_DENIED -> HttpStatus.FORBIDDEN;
            case NOT_FOUND -> HttpStatus.NOT_FOUND;
            case ALREADY_EXISTS, FAILED_PRECONDITION -> HttpStatus.CONFLICT;
            case UNAVAILABLE -> HttpStatus.SERVICE_UNAVAILABLE;
            default -> HttpStatus.INTERNAL_SERVER_ERROR;
        };
        if (httpStatus.is5xxServerError()) {
            log.error("downstream gRPC call failed: {}", status, e);
        }
        return ResponseEntity.status(httpStatus)
                .body(new ErrorResponse(status.getCode().name(), status.getDescription()));
    }

    // 例如 fileType 傳了 FileType enum 沒有的字串（FileType.valueOf 直接丟這個），
    // 這種輸入格式錯誤在還沒打到下游 gRPC 之前就發生，同樣當 400 處理。
    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<ErrorResponse> handleIllegalArgument(IllegalArgumentException e) {
        return ResponseEntity.badRequest().body(new ErrorResponse("INVALID_ARGUMENT", e.getMessage()));
    }
}
