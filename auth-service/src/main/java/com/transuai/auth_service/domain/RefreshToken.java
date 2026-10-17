package com.transuai.auth_service.domain;

import java.time.OffsetDateTime;
import java.util.UUID;

import org.hibernate.annotations.CreationTimestamp;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * 簽出去的一個 refresh token（只存雜湊）。同一次登入一路換發出來的屬於同一串（family）：被盜偵測到時、登出時整串作廢。
 */
@Entity
@Table(name = "refresh_tokens", indexes = {
        @Index(name = "idx_refresh_tokens_family", columnList = "family_id"),
        @Index(name = "idx_refresh_tokens_user", columnList = "user_id") })
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class RefreshToken {

    /** 為什麼不能再用：換發過了、登出了、或被當成被盜（已經換發過的又被用一次）。 */
    public enum RevokedReason {
        ROTATED, LOGGED_OUT, REUSED
    }

    /** JWT 的 jti。 */
    @Id
    private UUID id;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(name = "family_id", nullable = false)
    private UUID familyId;

    /** token 的 SHA-256（hex）：資料庫外洩也拿不到能用的 token。 */
    @Column(name = "token_hash", nullable = false, length = 64)
    private String tokenHash;

    @Column(name = "expires_at", nullable = false)
    private OffsetDateTime expiresAt;

    /** 這一串（這次登入）最晚到什麼時候：換發出來的 token 都不會超過，之後要重新登入。舊的列是 null（換發時從那時起算）。 */
    @Column(name = "family_expires_at")
    private OffsetDateTime familyExpiresAt;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    @Column(name = "revoked_at")
    private OffsetDateTime revokedAt;

    @Enumerated(EnumType.STRING)
    @Column(name = "revoked_reason", length = 16)
    private RevokedReason revokedReason;
}
