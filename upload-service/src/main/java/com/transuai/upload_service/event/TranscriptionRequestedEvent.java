package com.transuai.upload_service.event;

// 對應架構文件 5. MQ Topics/Queues 的 transcription.requested payload
public record TranscriptionRequestedEvent(String jobId, String storagePath, String fileType) {
}
