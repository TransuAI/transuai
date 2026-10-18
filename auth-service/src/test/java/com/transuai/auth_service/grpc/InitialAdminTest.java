package com.transuai.auth_service.grpc;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.grpc.test.autoconfigure.AutoConfigureTestGrpcTransport;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.grpc.client.GrpcChannelFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.transaction.support.TransactionTemplate;

import com.transuai.auth.grpc.v1.AuthResponse;
import com.transuai.auth.grpc.v1.AuthServiceGrpc;
import com.transuai.auth.grpc.v1.ChangePasswordRequest;
import com.transuai.auth.grpc.v1.GetSystemStatusRequest;
import com.transuai.auth.grpc.v1.LoginRequest;
import com.transuai.auth.grpc.v1.RegisterRequest;
import com.transuai.auth_service.PostgresContainerConfig;
import com.transuai.auth_service.repository.UserRepository;
import com.transuai.auth_service.security.CommonPasswords;
import com.transuai.auth_service.service.InitialAdmin;

import io.grpc.Metadata;
import io.grpc.stub.MetadataUtils;

/**
 * 安裝時建立的管理員（.scratch/initial-admin）：還沒有帳號時建立、要先改密碼；改好之後標記清掉，access token 不再帶 pwc。
 * 已經有帳號時不建立；設定不完整或密碼太弱時不啟動。
 */
@SpringBootTest
@AutoConfigureTestGrpcTransport
@Import(PostgresContainerConfig.class)
class InitialAdminTest {

    private static final String PASSWORD = "0f3a9c2e7b1d4f6a8c0e";
    private static final String NEW_PASSWORD = "the admin's own password";

    @Autowired
    private GrpcChannelFactory channels;
    @Autowired
    private JdbcTemplate jdbc;
    @Autowired
    private UserRepository users;
    @Autowired
    private PasswordEncoder passwordEncoder;
    @Autowired
    private CommonPasswords commonPasswords;
    @Autowired
    private TransactionTemplate transactions;

    @BeforeEach
    void freshInstall() {
        jdbc.execute("TRUNCATE users CASCADE");
    }

    @Test
    void onAFreshInstallTheAdminIsCreatedAndMustChangeThePassword() {
        String email = "admin-" + UUID.randomUUID() + "@example.com";

        assertThat(initialAdmin(email.toUpperCase(), PASSWORD).createIfNeeded()).isTrue();

        AuthResponse signedIn = login(email, PASSWORD);
        assertThat(signedIn.getUser().getIsAdmin()).isTrue();
        assertThat(signedIn.getUser().getMustChangePassword()).isTrue();
        assertThat(claims(signedIn.getAccessToken())).contains("\"pwc\":true");
        assertThat(stub().getSystemStatus(GetSystemStatusRequest.getDefaultInstance()).getSetupRequired()).isFalse();
    }

    @Test
    void changingThePasswordClearsIt() {
        String email = "admin-" + UUID.randomUUID() + "@example.com";
        initialAdmin(email, PASSWORD).createIfNeeded();
        AuthResponse signedIn = login(email, PASSWORD);

        AuthResponse changed = stubAs(signedIn.getUser().getId()).changePassword(ChangePasswordRequest.newBuilder()
                .setCurrentPassword(PASSWORD).setNewPassword(NEW_PASSWORD).build()).getSignedIn();

        assertThat(changed.getUser().getMustChangePassword()).isFalse();
        assertThat(claims(changed.getAccessToken())).doesNotContain("pwc");
        assertThat(login(email, NEW_PASSWORD).getUser().getMustChangePassword()).isFalse();
    }

    @Test
    void itDoesNothingOnceThereAreAccounts() {
        stub().register(RegisterRequest.newBuilder()
                .setEmail("someone-" + UUID.randomUUID() + "@example.com").setPassword("a-good-password").build());

        assertThat(initialAdmin("admin-" + UUID.randomUUID() + "@example.com", PASSWORD).createIfNeeded()).isFalse();
        assertThat(users.count()).isEqualTo(1);
    }

    @Test
    void withoutSettingsItDoesNothingAndTheFirstSignUpIsTheAdmin() {
        assertThat(initialAdmin("", "").createIfNeeded()).isFalse();
        assertThat(users.count()).isZero();
    }

    @Test
    void halfASettingOrAWeakPasswordStopsTheStart() {
        assertThatThrownBy(() -> initialAdmin("admin@example.com", "").createIfNeeded())
                .isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> initialAdmin("admin@example.com", "short").createIfNeeded())
                .isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> initialAdmin("admin@example.com", "unbelievable").createIfNeeded())
                .isInstanceOf(IllegalStateException.class);
        assertThat(users.count()).isZero();
    }

    @Test
    void anAccountThatSignsUpNormallyNeverHasToChangeItsPassword() {
        AuthResponse signedUp = stub().register(RegisterRequest.newBuilder()
                .setEmail("someone-" + UUID.randomUUID() + "@example.com").setPassword("a-good-password").build());

        assertThat(signedUp.getUser().getMustChangePassword()).isFalse();
        assertThat(claims(signedUp.getAccessToken())).doesNotContain("pwc");
    }

    private InitialAdmin initialAdmin(String email, String password) {
        return new InitialAdmin(users, passwordEncoder, commonPasswords, transactions, email, password);
    }

    private AuthResponse login(String email, String password) {
        return stub().login(LoginRequest.newBuilder().setEmail(email).setPassword(password).build());
    }

    private static String claims(String jwt) {
        return new String(Base64.getUrlDecoder().decode(jwt.split("\\.")[1]), StandardCharsets.UTF_8);
    }

    private AuthServiceGrpc.AuthServiceBlockingStub stub() {
        return AuthServiceGrpc.newBlockingStub(channels.createChannel("auth"));
    }

    private AuthServiceGrpc.AuthServiceBlockingStub stubAs(String userId) {
        Metadata headers = new Metadata();
        headers.put(Metadata.Key.of("x-user-id", Metadata.ASCII_STRING_MARSHALLER), userId);
        return stub().withInterceptors(MetadataUtils.newAttachHeadersInterceptor(headers));
    }
}
