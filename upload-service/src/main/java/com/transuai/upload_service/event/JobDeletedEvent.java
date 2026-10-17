package com.transuai.upload_service.event;

// job.deleted（fanout）：Job 刪掉了，transcription-service、ai-service 清掉自己手上這個 Job 的資料（見 architecture-design.md 5.）。
public record JobDeletedEvent(String jobId, String userId) {
}
