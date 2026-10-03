package com.transuai.auth_service.domain;

import java.time.OffsetDateTime;
import java.util.UUID;

import org.hibernate.annotations.CreationTimestamp;

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

// outbox：要發的事件跟引起它的資料變更寫在同一個交易裡，由 OutboxPublisher 送出、送出後刪掉。資料刪了、事件一定會送出
//（RabbitMQ 暫時連不上就晚一點送）；可能送不只一次，消費者都要能重複處理。
@Entity
@Table(name = "outbox_events", indexes = @Index(name = "idx_outbox_events_created_at", columnList = "created_at"))
@Getter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class OutboxEventEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    // 送到哪個 exchange（fanout，routing key 不用）
    @Column(name = "exchange", nullable = false, length = 128)
    private String exchange;

    // 訊息內容（JSON）
    @Column(name = "payload", nullable = false, columnDefinition = "text")
    private String payload;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;
}
