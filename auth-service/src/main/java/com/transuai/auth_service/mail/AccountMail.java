package com.transuai.auth_service.mail;

import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import org.springframework.mail.MailException;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.stereotype.Component;

import jakarta.annotation.PreDestroy;
import lombok.extern.slf4j.Slf4j;

/**
 * 寄給使用者的帳號信：重設密碼的連結（忘記密碼）、密碼改了或重設了的通知（ASVS 2.2.3、2.5.5）。SMTP 由部署的單位提供：管理員在
 * 系統設定頁存的，或環境變數（{@code SMTP_HOST} 等，見 README、{@link MailConfig}）；都沒有時 {@link #available()} 是 false，忘記密碼
 * 不能用、email 不用確認、通知不寄（記 log）。
 * <p>
 * 在背景寄：呼叫端不等 SMTP，寄不出去只記 log——忘記密碼的回應時間也就不會因為「有這個帳號、要寄信」而變長（不能用時間猜帳號）。
 */
@Component
@Slf4j
public class AccountMail {

    private static final DateTimeFormatter WHEN = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm").withZone(ZoneId.of("Asia/Taipei"));

    private final MailConfig config;
    private final ExecutorService executor = Executors.newSingleThreadExecutor(runnable -> {
        Thread thread = new Thread(runnable, "account-mail");
        thread.setDaemon(true);
        return thread;
    });

    public AccountMail(MailConfig config) {
        this.config = config;
    }

    /** 這個部署有沒有設定寄信（SMTP 主機與寄件人）。 */
    public boolean available() {
        return config.effective().enabled() && config.sender() != null;
    }

    /** 系統設定頁的「寄測試信」：用目前的設定寄一封、等它寄完。寄出去回 null，不然回原因。 */
    public String sendTest(String to) {
        MailConfig.Effective settings = config.effective();
        JavaMailSender mailSender = config.sender();
        if (!settings.enabled() || mailSender == null) {
            return "還沒有設定 SMTP 主機與寄件人";
        }
        SimpleMailMessage message = new SimpleMailMessage();
        message.setFrom(settings.from());
        message.setTo(to);
        message.setSubject("TransuAI 的測試信");
        message.setText("這是系統設定頁寄的測試信。收得到就表示寄信設定正確，忘記密碼與 email 確認可以用了。");
        try {
            mailSender.send(message);
            return null;
        } catch (MailException e) {
            log.warn("test mail to {} failed", to, e);
            Throwable cause = e.getMostSpecificCause();
            return cause.getMessage() == null ? cause.getClass().getSimpleName() : cause.getMessage();
        }
    }

    public void passwordResetLink(String to, String link, long validMinutes) {
        send(to, "重設你的 TransuAI 密碼", """
                有人要求重設這個帳號（%s）的密碼。

                要重設的話，請在 %d 分鐘內打開下面的連結（只能用一次）：

                %s

                如果不是你要求的，不用理會這封信，你的密碼不會改變。
                """.formatted(to, validMinutes, link));
    }

    public void emailVerificationLink(String to, String link, long validHours) {
        send(to, "確認你的 TransuAI email", """
                請打開下面的連結，確認這個 email（%s）是你的（%d 小時內有效、只能用一次）：

                %s

                確認之後，忘記密碼時才能用 email 重設。如果你沒有註冊 TransuAI，不用理會這封信。
                """.formatted(to, validHours, link));
    }

    public void recoveryCodesGenerated(String to, Instant at) {
        send(to, "你的 TransuAI 復原碼已更新", """
                你的帳號（%s）在 %s（台灣時間）產生了一組新的復原碼，之前的復原碼都不能用了。

                如果不是你本人做的，請馬上到登入頁用「忘記密碼」重設密碼，並通知管理這套系統的人員。
                """.formatted(to, WHEN.format(at)));
    }

    public void passwordResetWithRecoveryCode(String to, Instant at) {
        send(to, "你的 TransuAI 密碼已重設", changedBody(to, "用復原碼重設", at));
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
        MailConfig.Effective settings = config.effective();
        JavaMailSender mailSender = config.sender();
        if (!settings.enabled() || mailSender == null) {
            log.warn("mail is not configured (system settings or SMTP_HOST, MAIL_FROM); not sending \"{}\"", subject);
            return;
        }
        SimpleMailMessage message = new SimpleMailMessage();
        message.setFrom(settings.from());
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
