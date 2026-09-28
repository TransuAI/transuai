package com.transuai.gateway.usage;

import java.util.Locale;
import java.util.UUID;
import java.util.function.Supplier;

import org.springframework.stereotype.Component;

import com.transuai.gateway.web.dto.ModelChoiceDto;

import io.grpc.StatusRuntimeException;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import transuai.ai.v1.Ai.GetDefaultModelRequest;
import transuai.ai.v1.AiServiceGrpc;

/**
 * 花平台錢的 API 在送出之前檢查這個月的用量（{@link UsageLimits}）：到了上限回 429（{@link UsageLimitReachedException}），下個月
 * 1 日恢復。這個月已經在跑的（例如剛上傳、還在轉錄的）不受影響，所以最後一次可能超過一點。查不到用量（ai-service 或
 * transcription-service 連不上）時放行並記 log，跟限流一樣——那個服務真的掛了，接下來的呼叫自己會失敗。
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class UsageLimitGuard {

    /** ai-service 的平台模型在「模型」上的 provider 名稱（使用者的預設模型、問答臨時指定的模型）。 */
    private static final String PLATFORM_PROVIDER = "platform";

    private final MonthlyUsage usage;
    private final UsageLimits limits;
    private final AiServiceGrpc.AiServiceBlockingStub aiServiceStub;

    /**
     * 上傳前（取得上傳網址、完成上傳）：這個月的轉錄分鐘數還夠。durationSeconds 是這個檔案的長度（前端量的，不一定準；不知道就是
     * null），知道的話整個檔案要放得進剩下的分鐘數。
     */
    public void requireTranscriptionLeft(UUID userId, Integer durationSeconds) {
        double limitSeconds = limits.transcriptionMinutes() * 60.0;
        double adding = durationSeconds == null ? 0 : Math.max(0, durationSeconds);
        Double used = unlessUnavailable(() -> usage.transcriptionSecondsThisMonth(userId));
        if (used == null || (used < limitSeconds && used + adding <= limitSeconds)) {
            return;
        }
        String limit = "%s 分鐘".formatted(number(limits.transcriptionMinutes()));
        throw new UsageLimitReachedException(used >= limitSeconds
                ? "這個月的轉錄已經到用量上限（%s），下個月 1 日恢復".formatted(limit)
                : "這個檔案約 %s 分鐘，這個月的轉錄只剩 %s 分鐘（用量上限 %s），下個月 1 日恢復".formatted(
                        minutes(adding), minutes(limitSeconds - used), limit),
                UsageMonth.secondsUntilNextMonth());
    }

    /**
     * 呼叫 AI 之前：要用的是平台模型時，這個月的平台 token 還有剩。model 是這次臨時指定的模型（問答可以），沒指定就是使用者的預設
     * 模型。
     */
    public void requirePlatformTokensLeft(UUID userId, ModelChoiceDto model) {
        if (!PLATFORM_PROVIDER.equals(unlessUnavailable(() -> provider(userId, model)))) {
            return;
        }
        Long used = unlessUnavailable(() -> usage.platformTokensThisMonth(userId));
        if (used != null && used >= limits.platformTokens()) {
            throw new UsageLimitReachedException("這個月的平台模型已經到用量上限（%s tokens），下個月 1 日恢復；可以改用自有金鑰的模型"
                    .formatted(number(limits.platformTokens())), UsageMonth.secondsUntilNextMonth());
        }
    }

    public void requirePlatformTokensLeft(UUID userId) {
        requirePlatformTokensLeft(userId, null);
    }

    private String provider(UUID userId, ModelChoiceDto model) {
        return model != null ? model.provider()
                : aiServiceStub.getDefaultModel(GetDefaultModelRequest.newBuilder().setUserId(userId.toString()).build())
                        .getProvider();
    }

    /** 查不到（服務連不上）就是 null：放行。 */
    private static <T> T unlessUnavailable(Supplier<T> query) {
        try {
            return query.get();
        } catch (StatusRuntimeException e) {
            log.warn("usage limit not checked, usage unavailable: {}", e.getStatus());
            return null;
        }
    }

    private static String minutes(double seconds) {
        return String.format(Locale.ROOT, "%.0f", Math.ceil(seconds / 60));
    }

    private static String number(long value) {
        return String.format(Locale.ROOT, "%,d", value);
    }
}
