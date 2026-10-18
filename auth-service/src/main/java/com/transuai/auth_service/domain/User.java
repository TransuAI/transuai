package com.transuai.auth_service.domain;

import java.time.OffsetDateTime;
import java.util.UUID;

import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Entity
@Table(name = "users")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class User {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "email", nullable = false, unique = true, length = 255)
    private String email;

    @Column(name = "password_hash", nullable = false, length = 255)
    private String passwordHash;

    @Column(name = "display_name", length = 100)
    private String displayName;

    /** 角色：{@link #ADMIN}（能改系統設定）或 {@link #MEMBER}。第一個註冊的帳號是管理員。 */
    public static final String ADMIN = "admin";
    public static final String MEMBER = "member";

    @Builder.Default
    @Column(name = "role", nullable = false, length = 16, columnDefinition = "varchar(16) not null default 'member'")
    private String role = MEMBER;

    public boolean isAdmin() {
        return ADMIN.equals(role);
    }

    /**
     * 登入後要先改密碼才能做別的事：安裝時建立的管理員（密碼是 install.sh 產生、印在畫面上的）。改密碼或重設密碼後清掉。
     * gateway 從 access token 的 claim 知道（見 JwtService）。
     */
    @Builder.Default
    @Column(name = "must_change_password", nullable = false, columnDefinition = "boolean not null default false")
    private boolean mustChangePassword = false;

    /** 點了確認信的時間；null 是還沒確認（忘記密碼的信只寄給確認過的 email）。 */
    @Column(name = "email_verified_at")
    private OffsetDateTime emailVerifiedAt;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;
}
