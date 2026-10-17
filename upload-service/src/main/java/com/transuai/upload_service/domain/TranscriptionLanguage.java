package com.transuai.upload_service.domain;

import java.util.Optional;
import java.util.Set;

// 轉錄語言（見 transcription-service/docs/adr/0002）：zh-TW 是中文（預設）、en 是英文、auto 是請語音辨識在中文與英文之間
// 自動偵測。值原樣傳給 transcription-service。
public final class TranscriptionLanguage {

    public static final String CHINESE = "zh-TW";
    private static final Set<String> SUPPORTED = Set.of(CHINESE, "en", "auto");

    private TranscriptionLanguage() {
    }

    // 呼叫端要的語言：沒給（舊的前端）是中文；不認得的值是 empty。
    public static Optional<String> parse(String requested) {
        if (requested == null || requested.isBlank()) {
            return Optional.of(CHINESE);
        }
        return SUPPORTED.contains(requested) ? Optional.of(requested) : Optional.empty();
    }
}
