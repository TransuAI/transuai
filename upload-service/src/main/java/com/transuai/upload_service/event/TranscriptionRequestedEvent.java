package com.transuai.upload_service.event;

// 對應架構文件 5. MQ Topics/Queues 的 transcription.requested payload。userId 是 Job 擁有者，一路帶到 ai-service，
// 用量記在他名下。transcriptionLanguage 是上傳時選的轉錄語言（TranscriptionLanguage）。
public record TranscriptionRequestedEvent(String jobId, String userId, String storagePath, String fileType,
        String transcriptionLanguage) {
}
