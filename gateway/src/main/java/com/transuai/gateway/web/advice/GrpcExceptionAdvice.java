package com.transuai.gateway.web.advice;

import java.util.Map;
import java.util.UUID;

import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.validation.FieldError;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import com.transuai.gateway.ratelimit.RateLimitedException;
import com.transuai.gateway.usage.UsageLimitReachedException;
import com.transuai.gateway.web.dto.ErrorResponse;

import io.grpc.Status;
import io.grpc.StatusRuntimeException;
import jakarta.validation.ConstraintViolation;
import lombok.extern.slf4j.Slf4j;
import tools.jackson.databind.exc.UnrecognizedPropertyException;

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
            // 伺服器端的錯誤不把細節給使用者（Python 服務沒接住的例外，描述裡是例外訊息）：一般的訊息加上一個代碼，
            // log 裡用同一個代碼找得到細節（ASVS 7.4.1）。UNAVAILABLE 的描述是各服務寫給使用者看的「暫時無法…」，照樣傳。
            String errorId = UUID.randomUUID().toString().substring(0, 8);
            log.error("downstream gRPC call failed [{}]: {}", errorId, status, e);
            if (status.getCode() != Status.Code.UNAVAILABLE) {
                return ResponseEntity.status(httpStatus).body(new ErrorResponse("INTERNAL",
                        "伺服器發生錯誤，請稍後再試（錯誤代碼 " + errorId + "）"));
            }
        }
        return ResponseEntity.status(httpStatus)
                .body(new ErrorResponse(status.getCode().name(), status.getDescription()));
    }

    @ExceptionHandler(RateLimitedException.class)
    public ResponseEntity<ErrorResponse> handleRateLimited(RateLimitedException e) {
        return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                .header(HttpHeaders.RETRY_AFTER, String.valueOf(e.retryAfterSeconds()))
                .body(new ErrorResponse("RATE_LIMITED", e.getMessage()));
    }

    @ExceptionHandler(UsageLimitReachedException.class)
    public ResponseEntity<ErrorResponse> handleUsageLimitReached(UsageLimitReachedException e) {
        return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                .header(HttpHeaders.RETRY_AFTER, String.valueOf(e.retryAfterSeconds()))
                .body(new ErrorResponse("USAGE_LIMIT_REACHED", e.getMessage()));
    }

    // 請求的欄位不合 DTO 上的限制（ASVS 5.1.3、5.1.4）：說是哪個欄位、哪裡不對（第一個）。
    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ErrorResponse> handleInvalidField(MethodArgumentNotValidException e) {
        FieldError error = e.getBindingResult().getFieldError();
        String message = error == null ? "請求的內容不正確" : describe(error);
        return ResponseEntity.badRequest().body(new ErrorResponse("INVALID_ARGUMENT", message));
    }

    // JSON 壞掉、型別不對、或有不認得的欄位（ASVS 13.2.2）。不把 Jackson 的訊息（含類別名稱）給使用者。
    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ResponseEntity<ErrorResponse> handleUnreadable(HttpMessageNotReadableException e) {
        String message = e.getMostSpecificCause() instanceof UnrecognizedPropertyException unknown
                ? "不認得的欄位：" + unknown.getPropertyName()
                : "請求的內容格式不正確";
        return ResponseEntity.badRequest().body(new ErrorResponse("INVALID_ARGUMENT", message));
    }

    private static String describe(FieldError error) {
        String field = error.getField();
        Map<String, Object> limits = error.contains(ConstraintViolation.class)
                ? error.unwrap(ConstraintViolation.class).getConstraintDescriptor().getAttributes()
                : Map.of();
        return switch (String.valueOf(error.getCode())) {
            case "Size" -> field + " 最多 " + limits.get("max") + (error.getRejectedValue() instanceof String ? " 個字" : " 項");
            case "Pattern" -> field + " 的值不正確";
            case "NotNull", "NotBlank", "NotEmpty" -> field + " 是必填的";
            default -> field + " 超出範圍";
        };
    }

    // 例如 fileType 傳了 FileType enum 沒有的字串（FileType.valueOf 直接丟這個），
    // 這種輸入格式錯誤在還沒打到下游 gRPC 之前就發生，同樣當 400 處理。
    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<ErrorResponse> handleIllegalArgument(IllegalArgumentException e) {
        return ResponseEntity.badRequest().body(new ErrorResponse("INVALID_ARGUMENT", e.getMessage()));
    }
}
