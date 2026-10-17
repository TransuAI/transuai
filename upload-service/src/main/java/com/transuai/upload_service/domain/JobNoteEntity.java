package com.transuai.upload_service.domain;

import java.time.OffsetDateTime;
import java.util.UUID;

import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
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

// 筆記（見 CONTEXT.md「筆記」）：使用者在 Job 裡記下的一段文字，可以釘在錄音的某個時間點（只有時間、沒有文字的是書籤）。
// 釘在時間而不是片段：編輯逐字稿不改片段的時間，筆記不會跑掉。放在 upload_db：刪除 Job 時一起刪。
@Entity
@Table(name = "job_notes", indexes = @Index(name = "idx_job_notes_job_id", columnList = "job_id"))
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class JobNoteEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "job_id", nullable = false)
    private UUID jobId;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    // 錄音的哪個時間（秒）；null 是沒釘。
    @Column(name = "time_seconds")
    private Double timeSeconds;

    @Column(name = "text", nullable = false, length = 2000)
    @Builder.Default
    private String text = "";

    // manual（使用者寫的）或 qa（從問答存的）
    @Column(name = "source", nullable = false, length = 16)
    private String source;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;
}
