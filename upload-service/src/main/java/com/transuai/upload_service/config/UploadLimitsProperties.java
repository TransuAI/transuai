package com.transuai.upload_service.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

import com.transuai.upload.grpc.v1.FileType;

// maxFileSizeBytes 是不分檔案類型的濫用防護上限；maxAudioFileSizeBytes 是額外套用在 AUDIO 上傳的
// Groq Whisper 免費層檔案大小上限（見 docs/adr/0001-upload-size-limit-is-file-type-aware.md）——
// VIDEO 上傳的原始檔案大小跟最終送進 Groq 的音軌大小是兩回事，所以只套用前者，不套用後者。
@ConfigurationProperties(prefix = "app.upload")
public record UploadLimitsProperties(
        long maxFileSizeBytes,
        long maxAudioFileSizeBytes) {

    // 「哪種檔案類型套用哪個上限」這個政策只寫在這一個地方，getPresignedUploadUrl（用呼叫端回報的
    // 大小）跟 completeUpload（用物件儲存實際大小）都呼叫這個方法決定門檻，避免兩邊各自實作、
    // 未來改政策時漏改其中一邊。
    public long applicableMaxFileSizeBytes(FileType fileType) {
        return fileType == FileType.AUDIO ? Math.min(maxFileSizeBytes, maxAudioFileSizeBytes) : maxFileSizeBytes;
    }
}
