package com.transuai.auth_service.mail;

import java.util.Properties;

import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.JavaMailSenderImpl;
import org.springframework.stereotype.Component;

import com.transuai.auth_service.domain.MailSettings;
import com.transuai.auth_service.repository.MailSettingsRepository;
import com.transuai.auth_service.security.SecretBox;

/**
 * 目前用的寄信設定：管理員在系統設定頁存過就用存的（{@link MailSettings}），沒存過就用環境變數（SMTP_HOST 等，Spring 依它們建好的
 * {@link JavaMailSender}）。每次寄信都問這裡，所以設定頁存了馬上生效；存的設定沒變就重用同一個 sender。
 */
@Component
public class MailConfig {

    /** 實際用的設定。password 是解密後的（只在這個服務裡用，不往外傳）。 */
    public record Effective(String host, int port, String username, String password, String from, boolean starttls,
            boolean smtpAuth, boolean fromEnvironment) {

        public boolean enabled() {
            return host != null && !host.isBlank() && from != null && !from.isBlank();
        }
    }

    private final MailSettingsRepository repository;
    private final SecretBox secrets;
    private final ObjectProvider<JavaMailSender> environmentSender;
    private final Effective environment;

    private MailSettings cachedFor;
    private JavaMailSenderImpl cachedSender;

    public MailConfig(MailSettingsRepository repository, SecretBox secrets, ObjectProvider<JavaMailSender> environmentSender,
            @Value("${spring.mail.host:}") String host, @Value("${spring.mail.port:587}") int port,
            @Value("${spring.mail.username:}") String username, @Value("${spring.mail.password:}") String password,
            @Value("${app.mail.from:}") String from,
            @Value("${spring.mail.properties.mail.smtp.starttls.enable:true}") boolean starttls,
            @Value("${spring.mail.properties.mail.smtp.auth:true}") boolean smtpAuth) {
        this.repository = repository;
        this.secrets = secrets;
        this.environmentSender = environmentSender;
        this.environment = new Effective(host, port, username, password, from, starttls, smtpAuth, true);
    }

    public Effective effective() {
        return repository.findById(MailSettings.ONLY_ROW).map(this::fromSettings).orElse(environment);
    }

    /** 用目前的設定寄信的 sender；設定不夠寄信時是 null。 */
    public synchronized JavaMailSender sender() {
        MailSettings saved = repository.findById(MailSettings.ONLY_ROW).orElse(null);
        if (saved == null) {
            return environment.enabled() ? environmentSender.getIfAvailable() : null;
        }
        Effective settings = fromSettings(saved);
        if (!settings.enabled()) {
            return null;
        }
        if (cachedSender == null || cachedFor == null || !java.util.Objects.equals(cachedFor.getUpdatedAt(), saved.getUpdatedAt())) {
            cachedSender = build(settings);
            cachedFor = saved;
        }
        return cachedSender;
    }

    private Effective fromSettings(MailSettings saved) {
        String password = saved.getPasswordEncrypted() == null ? null : secrets.decrypt(saved.getPasswordEncrypted());
        return new Effective(saved.getHost(), saved.getPort(), saved.getUsername(), password, saved.getFromAddress(),
                saved.isStarttls(), saved.isSmtpAuth(), false);
    }

    private static JavaMailSenderImpl build(Effective settings) {
        JavaMailSenderImpl sender = new JavaMailSenderImpl();
        sender.setHost(settings.host());
        sender.setPort(settings.port());
        sender.setUsername(blankToNull(settings.username()));
        sender.setPassword(blankToNull(settings.password()));
        Properties properties = sender.getJavaMailProperties();
        properties.put("mail.smtp.auth", String.valueOf(settings.smtpAuth()));
        properties.put("mail.smtp.starttls.enable", String.valueOf(settings.starttls()));
        properties.put("mail.smtp.starttls.required", String.valueOf(settings.starttls()));
        properties.put("mail.smtp.connectiontimeout", "10000");
        properties.put("mail.smtp.timeout", "10000");
        return sender;
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value;
    }
}
