package com.transuai.gateway.usage;

import java.util.Locale;
import java.util.UUID;

import org.springframework.stereotype.Component;

import com.transuai.gateway.web.dto.ModelChoiceDto;

import lombok.RequiredArgsConstructor;
import transuai.ai.v1.Ai.GetDefaultModelRequest;
import transuai.ai.v1.AiServiceGrpc;

/**
 * 花平台錢的 API 在送出之前檢查這個月的用量（{@link UsageLimits}）：用完了回 429（{@link UsageLimitReachedException}），到下個月
 * 1 日恢復。這個月已經在跑的（例如剛上傳、還在轉錄的）不受影響，所以最後一次可能超過一點。
 */
@Component
@RequiredArgsConstructor
public class UsageLimitGuard {

    private final MonthlyUsage usage;
    private final UsageLimits limits;
    private final AiServiceGrpc.AiServiceBlockingStub aiServiceStub;

    /** 上傳前（取得上傳網址、完成上傳）：這個月的轉錄分鐘數還有剩。 */
    public void requireTranscriptionLeft(UUID userId) {
        if (usage.transcriptionSecondsThisMonth(userId) >= limits.transcriptionMinutes() * 60.0) {
            throw new UsageLimitReachedException("這個月的轉錄已經到用量上限（%s 分鐘），下個月 1 日恢復"
                    .formatted(number(limits.transcriptionMinutes())), MonthlyUsage.secondsUntilNextMonth());
        }
    }

    /**
     * 呼叫 AI 之前：要用的是平台模型時，這個月的平台 token 還有剩。model 是這次臨時指定的模型（問答可以），沒指定就是使用者的預設
     * 模型。
     */
    public void requirePlatformTokensLeft(UUID userId, ModelChoiceDto model) {
        String provider = model != null ? model.provider()
                : aiServiceStub.getDefaultModel(GetDefaultModelRequest.newBuilder().setUserId(userId.toString()).build())
                        .getProvider();
        if (MonthlyUsage.PLATFORM.equals(provider) && usage.platformTokensThisMonth(userId) >= limits.platformTokens()) {
            throw new UsageLimitReachedException("這個月的平台模型已經到用量上限（%s tokens），下個月 1 日恢復；可以改用自有金鑰的模型"
                    .formatted(number(limits.platformTokens())), MonthlyUsage.secondsUntilNextMonth());
        }
    }

    public void requirePlatformTokensLeft(UUID userId) {
        requirePlatformTokensLeft(userId, null);
    }

    private static String number(long value) {
        return String.format(Locale.ROOT, "%,d", value);
    }
}
