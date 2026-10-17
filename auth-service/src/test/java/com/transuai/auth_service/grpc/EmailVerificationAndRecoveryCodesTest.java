package com.transuai.auth_service.grpc;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.after;
import static org.mockito.Mockito.timeout;
import static org.mockito.Mockito.verify;

import java.util.List;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
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
import com.transuai.auth.grpc.v1.DeleteAccountRequest;
import com.transuai.auth.grpc.v1.GenerateRecoveryCodesRequest;
import com.transuai.auth.grpc.v1.GetMeRequest;
import com.transuai.auth.grpc.v1.LoginRequest;
import com.transuai.auth.grpc.v1.RefreshRequest;
import com.transuai.auth.grpc.v1.RegisterRequest;
import com.transuai.auth.grpc.v1.RequestPasswordResetRequest;
import com.transuai.auth.grpc.v1.ResendEmailVerificationRequest;
import com.transuai.auth.grpc.v1.ResetPasswordResponse;
import com.transuai.auth.grpc.v1.ResetPasswordWithRecoveryCodeRequest;
import com.transuai.auth.grpc.v1.VerifyEmailRequest;
import com.transuai.auth_service.PostgresContainerConfig;

import io.grpc.Metadata;
import io.grpc.Status;
import io.grpc.StatusRuntimeException;
import io.grpc.stub.MetadataUtils;

/**
 * 確認 email 與復原碼（.scratch/pre-launch-hardening/issues/24，ASVS 2.5.6）：註冊時寄確認信，忘記密碼的信只寄給確認過的 email；復原碼要目前的
 * 密碼才能產生、只顯示一次、一組只能用一次，可以不靠信箱重設密碼。SMTP 換成 mock。
 */
@SpringBootTest(properties = {"spring.mail.host=smtp.test", "app.mail.from=no-reply@transuai.test",
        "app.frontend-url=https://transuai.example"})
@AutoConfigureTestGrpcTransport
@Import(PostgresContainerConfig.class)
class EmailVerificationAndRecoveryCodesTest {

    private static final String PASSWORD = "a-good-password";
    private static final String NEW_PASSWORD = "an even better password";
    private static final Pattern VERIFY = Pattern.compile("https://transuai\\.example/verify-email#token=([A-Za-z0-9_-]{43})");
    private static final Pattern CODE = Pattern.compile("[A-HJ-NP-Z2-9]{5}(-[A-HJ-NP-Z2-9]{5}){3}");

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
    void signingUpSendsALinkThatConfirmsTheEmailOnce() {
        SimpleMailMessage confirmation = lastMail(1);
        assertThat(confirmation.getSubject()).isEqualTo("確認你的 TransuAI email");
        assertThat(confirmation.getText()).contains("24 小時內有效", "只能用一次");
        assertThat(me().getEmailVerified()).isFalse();
        String token = token(confirmation);

        stub().verifyEmail(VerifyEmailRequest.newBuilder().setToken(token).build());

        assertThat(me().getEmailVerified()).isTrue();
        assertCode(Status.Code.FAILED_PRECONDITION, () -> stub().verifyEmail(VerifyEmailRequest.newBuilder().setToken(token).build()));
    }

    @Test
    void anUnconfirmedEmailGetsNoResetLink() {
        lastMail(1);
        stub().requestPasswordReset(RequestPasswordResetRequest.newBuilder().setEmail(user.getUser().getEmail()).build());

        verify(mail, after(500).times(1)).send(any(SimpleMailMessage.class));  // only the confirmation
    }

    @Test
    void resendingSendsANewLinkAndTheOldOneStopsWorking() {
        String first = token(lastMail(1));

        stubAs(user).resendEmailVerification(ResendEmailVerificationRequest.getDefaultInstance());

        String second = token(lastMail(2));
        assertCode(Status.Code.FAILED_PRECONDITION, () -> stub().verifyEmail(VerifyEmailRequest.newBuilder().setToken(first).build()));
        stub().verifyEmail(VerifyEmailRequest.newBuilder().setToken(second).build());
        assertThat(me().getEmailVerified()).isTrue();
    }

    @Test
    void recoveryCodesNeedTheCurrentPasswordAndAreShownOnce() {
        assertCode(Status.Code.PERMISSION_DENIED, () -> generate("not the password"));
        assertThat(me().getRecoveryCodesLeft()).isZero();

        List<String> codes = generate(PASSWORD);

        assertThat(codes).hasSize(10).allMatch(code -> CODE.matcher(code).matches()).doesNotHaveDuplicates();
        assertThat(me().getRecoveryCodesLeft()).isEqualTo(10);
        assertThat(jdbc.queryForList("select code_hash from recovery_codes where user_id = ?::uuid", String.class,
                user.getUser().getId())).hasSize(10).noneMatch(codes::contains);
        assertThat(lastMail(2).getSubject()).isEqualTo("你的 TransuAI 復原碼已更新");
    }

    @Test
    void aRecoveryCodeSetsANewPasswordWithoutTheMailboxOnceAndEndsEverySignIn() {
        List<String> codes = generate(PASSWORD);
        String typedLoosely = codes.get(3).toLowerCase().replace("-", " ");

        ResetPasswordResponse reset = resetWith(user.getUser().getEmail(), typedLoosely, NEW_PASSWORD);

        assertThat(reset.getEndedSessionIdsList()).isNotEmpty();
        assertThat(login(NEW_PASSWORD)).isTrue();
        assertCode(Status.Code.UNAUTHENTICATED,
                () -> stub().refresh(RefreshRequest.newBuilder().setRefreshToken(user.getRefreshToken()).build()));
        assertThat(lastMail(3).getText()).contains("用復原碼重設了");
        assertThat(me().getRecoveryCodesLeft()).isEqualTo(9);
        assertCode(Status.Code.FAILED_PRECONDITION, () -> resetWith(user.getUser().getEmail(), codes.get(3), "yet another password"));
        resetWith(user.getUser().getEmail(), codes.get(4), "yet another password");
    }

    @Test
    void aWrongEmailOrCodeGetsTheSameAnswerAndNewCodesReplaceTheOldOnes() {
        List<String> old = generate(PASSWORD);
        List<String> current = generate(PASSWORD);

        assertThatThrownBy(() -> resetWith("nobody-" + UUID.randomUUID() + "@example.com", current.get(0), NEW_PASSWORD))
                .isInstanceOfSatisfying(StatusRuntimeException.class,
                        e -> assertThat(e.getStatus().getDescription()).isEqualTo("email 或復原碼不對，或這組復原碼已經用過了"));
        assertCode(Status.Code.FAILED_PRECONDITION, () -> resetWith(user.getUser().getEmail(), old.get(0), NEW_PASSWORD));
        assertCode(Status.Code.INVALID_ARGUMENT, () -> resetWith(user.getUser().getEmail(), current.get(0), "short"));
        assertThat(me().getRecoveryCodesLeft()).isEqualTo(10);  // a rejected new password doesn't use the code up
    }

    @Test
    void deletingTheAccountRemovesItsCodesAndLinks() {
        generate(PASSWORD);

        stubAs(user).deleteAccount(DeleteAccountRequest.newBuilder().setPassword(PASSWORD).build());

        for (String table : new String[] {"recovery_codes", "email_verification_tokens"}) {
            assertThat(jdbc.queryForObject("select count(*) from " + table + " where user_id = ?::uuid", Integer.class,
                    user.getUser().getId())).as(table).isZero();
        }
    }

    private List<String> generate(String currentPassword) {
        return stubAs(user).generateRecoveryCodes(GenerateRecoveryCodesRequest.newBuilder()
                .setCurrentPassword(currentPassword).build()).getCodesList();
    }

    private ResetPasswordResponse resetWith(String email, String code, String newPassword) {
        return stub().resetPasswordWithRecoveryCode(ResetPasswordWithRecoveryCodeRequest.newBuilder()
                .setEmail(email).setCode(code).setNewPassword(newPassword).build());
    }

    private com.transuai.auth.grpc.v1.User me() {
        return stubAs(user).getMe(GetMeRequest.getDefaultInstance());
    }

    private static String token(SimpleMailMessage message) {
        Matcher link = VERIFY.matcher(message.getText());
        assertThat(link.find()).isTrue();
        return link.group(1);
    }

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
