package com.transuai.auth_service.mail;

import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.mail.MailException;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.stereotype.Component;

import jakarta.annotation.PreDestroy;
import lombok.extern.slf4j.Slf4j;

/**
 * 寄給使用者的帳號信：重設密碼的連結（忘記密碼）、密碼改了或重設了的通知（ASVS 2.2.3、2.5.5）。SMTP 由部署的單位提供（{@code SMTP_HOST}
 * 等，見 README）；沒設定時 {@link #available()} 是 false，忘記密碼不能用、通知不寄（記 log）。
 * <p>
 * 在背景寄：呼叫端不等 SMTP，寄不出去只記 log——忘記密碼的回應時間也就不會因為「有這個帳號、要寄信」而變長（不能用時間猜帳號）。
 */
@Component
@Slf4j
public class AccountMail {

    private static final DateTimeFormatter WHEN = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm").withZone(ZoneId.of("Asia/Taipei"));

    private final ObjectProvider<JavaMailSender> sender;
    private final String host;
    private final String from;
    private final ExecutorService executor = Executors.newSingleThreadExecutor(runnable -> {
        Thread thread = new Thread(runnable, "account-mail");
        thread.setDaemon(true);
        return thread;
    });

    public AccountMail(ObjectProvider<JavaMailSender> sender, @Value("${spring.mail.host:}") String host,
            @Value("${app.mail.from}") String from) {
        this.sender = sender;
        this.host = host;
        this.from = from;
    }

    /** 這個部署有沒有設定寄信（SMTP 主機與寄件人；SMTP_HOST 是空字串時 Spring 照樣會建出 sender，所以另外看）。 */
    public boolean available() {
        return !host.isBlank() && !from.isBlank() && sender.getIfAvailable() != null;
    }

    public void passwordResetLink(String to, String link, long validMinutes) {
        send(to, "重設你的 TransuAI 密碼", """
                有人要求重設這個帳號（%s）的密碼。

                要重設的話，請在 %d 分鐘內打開下面的連結（只能用一次）：

                %s

                如果不是你要求的，不用理會這封信，你的密碼不會改變。
                """.formatted(to, validMinutes, link));
    }

    public void passwordChanged(String to, Instant at) {
        send(to, "你的 TransuAI 密碼已更改", changedBody(to, "更改", at));
    }

    public void passwordWasReset(String to, Instant at) {
        send(to, "你的 TransuAI 密碼已重設", changedBody(to, "用「忘記密碼」重設", at));
    }

    private static String changedBody(String to, String how, Instant at) {
        return """
                你的帳號（%s）的密碼在 %s（台灣時間）%s了，其他裝置上的登入都已經登出。

                如果不是你本人做的，請馬上到登入頁用「忘記密碼」重設密碼，並通知管理這套系統的人員。
                """.formatted(to, WHEN.format(at), how);
    }

    private void send(String to, String subject, String body) {
        JavaMailSender mailSender = sender.getIfAvailable();
        if (!available()) {
            log.warn("mail is not configured (SMTP_HOST, MAIL_FROM); not sending \"{}\"", subject);
            return;
        }
        SimpleMailMessage message = new SimpleMailMessage();
        message.setFrom(from);
        message.setTo(to);
        message.setSubject(subject);
        message.setText(body);
        executor.execute(() -> {
            try {
                mailSender.send(message);
            } catch (MailException e) {
                log.warn("could not send \"{}\"", subject, e);
            }
        });
    }

    @PreDestroy
    void stop() {
        executor.shutdown();
    }
}
