package com.transuai.upload_service.domain;

import java.time.OffsetDateTime;
import java.util.UUID;

import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

// 名字叫 JobEntity（不是 Job）、Status/FileType 巢狀在裡面（不是頂層 JobStatus/FileType），
// 是刻意的：這個類別的欄位鏡射 infra/proto/upload.proto 的 Job/JobStatus/FileType message，
// 兩邊在同一個檔案（尤其是 JobMapper）常常要同時出現，撞名字的話只能整檔用完整路徑寫，
// 讀起來很難看也容易漏改。用不同的名字，兩邊都能乾淨地 import、不用寫完整路徑。
@Entity
@Table(name = "jobs", indexes = {
        @Index(name = "idx_jobs_user_id", columnList = "user_id"),
        @Index(name = "idx_jobs_status", columnList = "status")
})
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class JobEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(name = "file_name", nullable = false, length = 255)
    private String fileName;

    @Enumerated(EnumType.STRING)
    @Column(name = "file_type", nullable = false, length = 20)
    private FileType fileType;

    @Column(name = "file_size_bytes", nullable = false)
    private long fileSizeBytes;

    @Column(name = "storage_path", nullable = false, length = 500)
    private String storagePath;

    @Column(name = "duration_seconds")
    private Integer durationSeconds;

    // 轉錄語言（TranscriptionLanguage）；這個欄位之前建立的 Job 是 null，當成中文。
    @Column(name = "transcription_language", length = 10)
    private String transcriptionLanguage;

    // 標題（見 CONTEXT.md「標題」）：AI 依內容取的，或使用者改的；null 是沒有標題（顯示檔名）。
    // 標題的上限；AI 取的標題本來就短得多（ai-service 截到 40 字）。
    public static final int MAX_TITLE_LENGTH = 100;

    @Column(name = "title", length = MAX_TITLE_LENGTH)
    private String title;

    // 類型（JobCategory）；null 是還沒判斷。
    @Column(name = "category", length = 20)
    private String category;

    // 使用者改過就是 true：AI 之後不會再寫這個欄位（包括使用者把標題清空）。舊的列是 null，當成 false。
    @Column(name = "title_set_by_user")
    private Boolean titleSetByUser;

    @Column(name = "category_set_by_user")
    private Boolean categorySetByUser;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false, length = 30)
    @Builder.Default
    private Status status = Status.PENDING;

    @Column(name = "error_reason", columnDefinition = "TEXT")
    private String errorReason;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;

    // 狀態機：PENDING → UPLOADING → UPLOADED → TRANSCRIBING → TRANSCRIBED
    //        → SUMMARIZING → COMPLETED（任一階段可轉 FAILED，並記錄 error_reason）
    public enum Status {
        PENDING,
        UPLOADING,
        UPLOADED,
        TRANSCRIBING,
        TRANSCRIBED,
        SUMMARIZING,
        COMPLETED,
        FAILED
    }

    public enum FileType {
        AUDIO,
        VIDEO
    }
}
