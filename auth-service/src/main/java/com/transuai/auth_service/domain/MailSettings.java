package com.transuai.auth_service.domain;

import java.time.OffsetDateTime;

import org.hibernate.annotations.UpdateTimestamp;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * 管理員在系統設定頁存的寄信設定（只有一列，id 1）。有這一列就用它，沒有就用環境變數（SMTP_HOST 等）。密碼用
 * KEY_ENCRYPTION_KEY 加密（{@link com.transuai.auth_service.security.SecretBox}）。
 */
@Entity
@Table(name = "mail_settings")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class MailSettings {

    public static final int ONLY_ROW = 1;

    @Id
    private Integer id;

    @Column(name = "host", length = 255)
    private String host;

    @Column(name = "port", nullable = false)
    private int port;

    @Column(name = "username", length = 255)
    private String username;

    @Column(name = "password_encrypted", columnDefinition = "text")
    private String passwordEncrypted;

    @Column(name = "from_address", length = 255)
    private String fromAddress;

    @Column(name = "starttls", nullable = false)
    private boolean starttls;

    @Column(name = "smtp_auth", nullable = false)
    private boolean smtpAuth;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private OffsetDateTime updatedAt;
}
