package com.transuai.auth_service.grpc;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.grpc.test.autoconfigure.AutoConfigureTestGrpcTransport;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.grpc.client.GrpcChannelFactory;
import org.springframework.jdbc.core.JdbcTemplate;

import com.transuai.auth.grpc.v1.AuthServiceGrpc;
import com.transuai.auth.grpc.v1.GetMailSettingsRequest;
import com.transuai.auth.grpc.v1.GetSystemStatusRequest;
import com.transuai.auth.grpc.v1.RegisterRequest;
import com.transuai.auth.grpc.v1.SendTestMailRequest;
import com.transuai.auth.grpc.v1.UpdateMailSettingsRequest;
import com.transuai.auth_service.PostgresContainerConfig;

import io.grpc.Metadata;
import io.grpc.Status;
import io.grpc.StatusRuntimeException;
import io.grpc.stub.MetadataUtils;

/** 系統設定的「寄信」：只有管理員能看能改，存了馬上生效，密碼加密存、不回傳，可以寄測試信，可以回到環境變數。 */
@SpringBootTest(properties = "app.key-encryption-key=dGVzdC1tYXN0ZXIta2V5LWZvci1hZXMtZ2NtLTMyYiE=")
@AutoConfigureTestGrpcTransport
@Import(PostgresContainerConfig.class)
class MailSettingsTest {

    @Autowired
    private GrpcChannelFactory channels;

    @Autowired
    private JdbcTemplate jdbc;

    private AuthServiceGrpc.AuthServiceBlockingStub admin;
    private AuthServiceGrpc.AuthServiceBlockingStub member;

    @BeforeEach
    void freshInstallWithAnAdminAndAMember() {
        jdbc.execute("TRUNCATE users, mail_settings CASCADE");
        var stub = AuthServiceGrpc.newBlockingStub(channels.createChannel("auth"));
        admin = as(stub, stub.register(register()).getUser().getId());
        member = as(stub, stub.register(register()).getUser().getId());
    }

    @Test
    void onlyTheAdminSeesAndChangesThem() {
        assertThatThrownBy(() -> member.getMailSettings(GetMailSettingsRequest.getDefaultInstance()))
                .isInstanceOfSatisfying(StatusRuntimeException.class,
                        e -> assertThat(e.getStatus().getCode()).isEqualTo(Status.Code.PERMISSION_DENIED));
        assertThatThrownBy(() -> member.updateMailSettings(smtp("secret-password")))
                .isInstanceOf(StatusRuntimeException.class);
    }

    @Test
    void savedSettingsTakeEffectAtOnceAndTheirPasswordIsKeptSecret() {
        var before = admin.getMailSettings(GetMailSettingsRequest.getDefaultInstance());
        assertThat(before.getFromEnvironment()).isTrue();
        assertThat(before.getEnabled()).isFalse(); // the tests run without SMTP_HOST

        var saved = admin.updateMailSettings(smtp("secret-password"));

        assertThat(saved.getFromEnvironment()).isFalse();
        assertThat(saved.getEnabled()).isTrue();
        assertThat(saved.getHost()).isEqualTo("smtp.example.com");
        assertThat(saved.getPasswordSet()).isTrue();
        assertThat(saved.toString()).doesNotContain("secret-password");
        assertThat(jdbc.queryForObject("SELECT password_encrypted FROM mail_settings", String.class))
                .isNotBlank().doesNotContain("secret-password");
        assertThat(admin.getSystemStatus(GetSystemStatusRequest.getDefaultInstance()).getMailEnabled()).isTrue();

        // Saving again without a password keeps the one already saved.
        assertThat(admin.updateMailSettings(smtp("")).getPasswordSet()).isTrue();
        // Back to the environment variables.
        var reset = admin.updateMailSettings(UpdateMailSettingsRequest.newBuilder().setUseEnvironment(true).build());
        assertThat(reset.getFromEnvironment()).isTrue();
        assertThat(admin.getSystemStatus(GetSystemStatusRequest.getDefaultInstance()).getMailEnabled()).isFalse();
    }

    @Test
    void aTestMailSaysWhyItCouldNotBeSent() {
        assertThat(admin.sendTestMail(SendTestMailRequest.getDefaultInstance()).getSent()).isFalse();

        admin.updateMailSettings(UpdateMailSettingsRequest.newBuilder().setHost("127.0.0.1").setPort(1)
                .setFrom("no-reply@example.com").build());
        var result = admin.sendTestMail(SendTestMailRequest.getDefaultInstance());

        assertThat(result.getSent()).isFalse();
        assertThat(result.getError()).isNotBlank();
    }

    private static UpdateMailSettingsRequest smtp(String password) {
        return UpdateMailSettingsRequest.newBuilder().setHost("smtp.example.com").setPort(587).setUsername("mailer")
                .setPassword(password).setFrom("no-reply@example.com").setStarttls(true).setSmtpAuth(true).build();
    }

    private static RegisterRequest register() {
        return RegisterRequest.newBuilder().setEmail("user-" + UUID.randomUUID() + "@example.com").setPassword("a-good-password").build();
    }

    private static AuthServiceGrpc.AuthServiceBlockingStub as(AuthServiceGrpc.AuthServiceBlockingStub stub, String userId) {
        Metadata headers = new Metadata();
        headers.put(Metadata.Key.of("x-user-id", Metadata.ASCII_STRING_MARSHALLER), userId);
        return stub.withInterceptors(MetadataUtils.newAttachHeadersInterceptor(headers));
    }
}
