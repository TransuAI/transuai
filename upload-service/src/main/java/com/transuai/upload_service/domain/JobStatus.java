package com.transuai.upload_service.domain;

// 狀態機：PENDING → UPLOADING → UPLOADED → TRANSCRIBING → TRANSCRIBED
//        → SUMMARIZING → COMPLETED（任一階段可轉 FAILED，並記錄 error_reason）
public enum JobStatus {
    PENDING,
    UPLOADING,
    UPLOADED,
    TRANSCRIBING,
    TRANSCRIBED,
    SUMMARIZING,
    COMPLETED,
    FAILED
}
