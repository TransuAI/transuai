package com.transuai.auth_service.mail;

import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import com.transuai.auth.grpc.v1.UpdateMailSettingsRequest;
import com.transuai.auth_service.domain.MailSettings;
import com.transuai.auth_service.repository.MailSettingsRepository;
import com.transuai.auth_service.security.SecretBox;

import lombok.RequiredArgsConstructor;

/** 系統設定頁的「寄信」：讀目前的設定（密碼不外流）、存新的設定或回到環境變數。權限由呼叫端（gRPC）先檢查。 */
@Component
@RequiredArgsConstructor
public class MailSettingsAdmin {

    /** 存密碼卻沒有主金鑰。 */
    public static class NoEncryptionKey extends RuntimeException {
        public NoEncryptionKey() {
            super("要在設定頁存 SMTP 密碼，伺服器要先設定 KEY_ENCRYPTION_KEY");
        }
    }

    private final MailConfig config;
    private final MailSettingsRepository repository;
    private final SecretBox secrets;

    public com.transuai.auth.grpc.v1.MailSettings current() {
        MailConfig.Effective settings = config.effective();
        return com.transuai.auth.grpc.v1.MailSettings.newBuilder()
                .setHost(nullToEmpty(settings.host()))
                .setPort(settings.port())
                .setUsername(nullToEmpty(settings.username()))
                .setPasswordSet(settings.password() != null && !settings.password().isBlank())
                .setFrom(nullToEmpty(settings.from()))
                .setStarttls(settings.starttls())
                .setSmtpAuth(settings.smtpAuth())
                .setFromEnvironment(settings.fromEnvironment())
                .setEnabled(settings.enabled())
                .build();
    }

    @Transactional
    public com.transuai.auth.grpc.v1.MailSettings update(UpdateMailSettingsRequest request) {
        if (request.getUseEnvironment()) {
            repository.deleteById(MailSettings.ONLY_ROW);
            repository.flush();
            return current();
        }
        MailSettings saved = repository.findById(MailSettings.ONLY_ROW).orElseGet(() -> MailSettings.builder().id(MailSettings.ONLY_ROW).build());
        // 第一次在設定頁存、又沒填密碼：沿用環境變數的密碼（不然存了反而少了密碼）。
        if (saved.getHost() == null && saved.getPasswordEncrypted() == null && request.getPassword().isEmpty()
                && !request.getClearPassword()) {
            String environmentPassword = config.effective().password();
            if (environmentPassword != null && !environmentPassword.isBlank()) {
                saved.setPasswordEncrypted(encrypt(environmentPassword));
            }
        }
        saved.setHost(request.getHost().trim());
        saved.setPort(request.getPort() > 0 ? request.getPort() : 587);
        saved.setUsername(request.getUsername().trim());
        saved.setFromAddress(request.getFrom().trim());
        saved.setStarttls(request.getStarttls());
        saved.setSmtpAuth(request.getSmtpAuth());
        if (request.getClearPassword()) {
            saved.setPasswordEncrypted(null);
        } else if (!request.getPassword().isEmpty()) {
            saved.setPasswordEncrypted(encrypt(request.getPassword()));
        }
        repository.saveAndFlush(saved);
        return current();
    }

    private String encrypt(String password) {
        if (!secrets.available()) {
            throw new NoEncryptionKey();
        }
        return secrets.encrypt(password);
    }

    private static String nullToEmpty(String value) {
        return value == null ? "" : value;
    }
}
