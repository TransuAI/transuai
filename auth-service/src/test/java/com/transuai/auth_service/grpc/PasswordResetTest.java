package com.transuai.auth_service.grpc;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.after;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.verify;

import java.util.List;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.Mockito;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.grpc.test.autoconfigure.AutoConfigureTestGrpcTransport;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.grpc.client.GrpcChannelFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

import com.transuai.auth.grpc.v1.AuthResponse;
import com.transuai.auth.grpc.v1.AuthServiceGrpc;
import com.transuai.auth.grpc.v1.ChangePasswordRequest;
import com.transuai.auth.grpc.v1.DeleteAccountRequest;
import com.transuai.auth.grpc.v1.LoginRequest;
import com.transuai.auth.grpc.v1.RefreshRequest;
import com.transuai.auth.grpc.v1.RegisterRequest;
import com.transuai.auth.grpc.v1.RequestPasswordResetRequest;
import com.transuai.auth.grpc.v1.ResetPasswordRequest;
import com.transuai.auth.grpc.v1.ResetPasswordResponse;
import com.transuai.auth_service.PostgresContainerConfig;

import io.grpc.Metadata;
import io.grpc.Status;
import io.grpc.StatusRuntimeException;
import io.grpc.stub.MetadataUtils;

/**
 * 忘記密碼與帳號異動通知（.scratch/pre-launch-hardening/issues/19，ASVS 2.2.3、2.5.x）：寄一次性、限時的重設連結（不透露 email 有沒有註冊）；
 * 重設後其他登入全部作廢、寄通知；改密碼也寄通知。SMTP 換成 mock，信的內容直接看。
 */
@SpringBootTest(properties = {"spring.mail.host=smtp.test", "app.mail.from=no-reply@transuai.test",
        "app.frontend-url=https://transuai.example/"})
@AutoConfigureTestGrpcTransport
@Import(PostgresContainerConfig.class)
class PasswordResetTest {

    private static final String PASSWORD = "a-good-password";
    private static final String NEW_PASSWORD = "an even better password";
    private static final Pattern LINK = Pattern.compile("https://transuai\\.example/reset-password#token=([A-Za-z0-9_-]{43})");

    @Autowired
    private GrpcChannelFactory channels;

    @Autowired
    private JdbcTemplate jdbc;

    @MockitoBean
    private JavaMailSender mail;

    private AuthResponse user;

    @BeforeEach
    void setUp() {
        user = stub().register(RegisterRequest.newBuilder()
                .setEmail("user-" + UUID.randomUUID() + "@example.com").setPassword(PASSWORD).build());
    }

    @Test
    void theLinkInTheMailSetsANewPasswordAndEndsEverySignIn() {
        String token = requestReset();

        ResetPasswordResponse reset = stub().resetPassword(ResetPasswordRequest.newBuilder()
                .setToken(token).setNewPassword(NEW_PASSWORD).build());

        assertThat(reset.getUserId()).isEqualTo(user.getUser().getId());
        assertThat(reset.getEndedSessionIdsList()).hasSize(1);
        assertThat(login(NEW_PASSWORD)).isTrue();
        assertThat(login(PASSWORD)).isFalse();
        assertCode(Status.Code.UNAUTHENTICATED,
                () -> stub().refresh(RefreshRequest.newBuilder().setRefreshToken(user.getRefreshToken()).build()));
        SimpleMailMessage notice = lastMail(2);
        assertThat(notice.getSubject()).isEqualTo("你的 TransuAI 密碼已重設");
        assertThat(notice.getText()).contains("其他裝置上的登入都已經登出", "如果不是你本人做的").doesNotContain(token);
    }

    @Test
    void theResetMailSaysHowLongTheOneUseLinkLastsAndComesFromTheConfiguredSender() {
        requestReset();

        SimpleMailMessage message = lastMail(1);
        assertThat(message.getTo()).containsExactly(user.getUser().getEmail());
        assertThat(message.getFrom()).isEqualTo("no-reply@transuai.test");
        assertThat(message.getSubject()).isEqualTo("重設你的 TransuAI 密碼");
        assertThat(message.getText()).contains("30 分鐘內", "只能用一次", "如果不是你要求的");
    }

    @Test
    void anUnknownEmailGetsTheSameAnswerAndNoMail() {
        stub().requestPasswordReset(RequestPasswordResetRequest.newBuilder().setEmail("nobody-" + UUID.randomUUID() + "@example.com").build());

        verify(mail, after(500).never()).send(any(SimpleMailMessage.class));
    }

    @Test
    void aLinkWorksOnce() {
        String token = requestReset();
        stub().resetPassword(ResetPasswordRequest.newBuilder().setToken(token).setNewPassword(NEW_PASSWORD).build());

        assertThatThrownBy(() -> stub().resetPassword(ResetPasswordRequest.newBuilder()
                .setToken(token).setNewPassword("yet another new password").build()))
                .isInstanceOfSatisfying(StatusRuntimeException.class, e -> {
                    assertThat(e.getStatus().getCode()).isEqualTo(Status.Code.FAILED_PRECONDITION);
                    assertThat(e.getStatus().getDescription()).isEqualTo("這個重設連結無效或已過期，請重新申請");
                });
        assertThat(login(NEW_PASSWORD)).isTrue();
    }

    @Test
    void anExpiredLinkOrAnOlderOneNoLongerWorks() {
        String older = requestReset();
        String newer = requestReset();
        assertCode(Status.Code.FAILED_PRECONDITION, () -> reset(older, NEW_PASSWORD));

        jdbc.update("update password_reset_tokens set expires_at = now() - interval '1 second' where user_id = ?::uuid",
                user.getUser().getId());
        assertCode(Status.Code.FAILED_PRECONDITION, () -> reset(newer, NEW_PASSWORD));
        assertCode(Status.Code.FAILED_PRECONDITION, () -> reset("made-up", NEW_PASSWORD));
        assertThat(login(PASSWORD)).isTrue();
    }

    @Test
    void aNewPasswordThatBreaksTheRulesDoesNotUseUpTheLink() {
        String token = requestReset();

        assertCode(Status.Code.INVALID_ARGUMENT, () -> reset(token, "short"));
        assertCode(Status.Code.INVALID_ARGUMENT, () -> reset(token, "Password1234!"));

        reset(token, NEW_PASSWORD);
        assertThat(login(NEW_PASSWORD)).isTrue();
    }

    @Test
    void onlyAHashOfTheLinkIsStoredAndDeletingTheAccountRemovesIt() {
        String token = requestReset();
        assertThat(jdbc.queryForList("select token_hash from password_reset_tokens where user_id = ?::uuid", String.class,
                user.getUser().getId())).hasSize(1).noneMatch(stored -> stored.equals(token));

        stubAs(user).deleteAccount(DeleteAccountRequest.newBuilder().setPassword(PASSWORD).build());

        assertThat(jdbc.queryForObject("select count(*) from password_reset_tokens where user_id = ?::uuid", Integer.class,
                user.getUser().getId())).isZero();
    }

    @Test
    void changingThePasswordSendsANotice() {
        stubAs(user).changePassword(ChangePasswordRequest.newBuilder()
                .setCurrentPassword(PASSWORD).setNewPassword(NEW_PASSWORD).build());

        SimpleMailMessage notice = lastMail(1);
        assertThat(notice.getTo()).containsExactly(user.getUser().getEmail());
        assertThat(notice.getSubject()).isEqualTo("你的 TransuAI 密碼已更改");
        assertThat(notice.getText()).contains("更改了", "如果不是你本人做的，請馬上到登入頁用「忘記密碼」重設密碼");
    }

    private String requestReset() {
        int before = Mockito.mockingDetails(mail).getInvocations().size();
        stub().requestPasswordReset(RequestPasswordResetRequest.newBuilder()
                .setEmail("  " + user.getUser().getEmail().toUpperCase() + " ").build());
        Matcher link = LINK.matcher(lastMail(before + 1).getText());
        assertThat(link.find()).isTrue();
        return link.group(1);
    }

    private ResetPasswordResponse reset(String token, String newPassword) {
        return stub().resetPassword(ResetPasswordRequest.newBuilder().setToken(token).setNewPassword(newPassword).build());
    }

    // The mails are sent in the background: wait until `count` have gone out, return the last.
    private SimpleMailMessage lastMail(int count) {
        ArgumentCaptor<SimpleMailMessage> sent = ArgumentCaptor.forClass(SimpleMailMessage.class);
        verify(mail, timeout(5000).times(count)).send(sent.capture());
        List<SimpleMailMessage> all = sent.getAllValues();
        return all.get(all.size() - 1);
    }

    private boolean login(String password) {
        try {
            stub().login(LoginRequest.newBuilder().setEmail(user.getUser().getEmail()).setPassword(password).build());
            return true;
        } catch (StatusRuntimeException e) {
            return false;
        }
    }

    private static void assertCode(Status.Code code, Runnable call) {
        assertThatThrownBy(call::run).isInstanceOfSatisfying(StatusRuntimeException.class,
                e -> assertThat(e.getStatus().getCode()).isEqualTo(code));
    }

    private AuthServiceGrpc.AuthServiceBlockingStub stub() {
        return AuthServiceGrpc.newBlockingStub(channels.createChannel("auth"));
    }

    private AuthServiceGrpc.AuthServiceBlockingStub stubAs(AuthResponse signedIn) {
        Metadata headers = new Metadata();
        headers.put(Metadata.Key.of("x-user-id", Metadata.ASCII_STRING_MARSHALLER), signedIn.getUser().getId());
        return stub().withInterceptors(MetadataUtils.newAttachHeadersInterceptor(headers));
    }
}
