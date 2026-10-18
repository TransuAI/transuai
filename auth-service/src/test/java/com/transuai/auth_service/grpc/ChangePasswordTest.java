package com.transuai.auth_service.grpc;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.grpc.test.autoconfigure.AutoConfigureTestGrpcTransport;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.grpc.client.GrpcChannelFactory;
import org.springframework.jdbc.core.JdbcTemplate;

import com.transuai.auth.grpc.v1.AuthResponse;
import com.transuai.auth.grpc.v1.AuthServiceGrpc;
import com.transuai.auth.grpc.v1.ChangePasswordRequest;
import com.transuai.auth.grpc.v1.ChangePasswordResponse;
import com.transuai.auth.grpc.v1.LoginRequest;
import com.transuai.auth.grpc.v1.RefreshRequest;
import com.transuai.auth.grpc.v1.RegisterRequest;
import com.transuai.auth_service.PostgresContainerConfig;

import io.grpc.Metadata;
import io.grpc.Status;
import io.grpc.StatusRuntimeException;
import io.grpc.stub.MetadataUtils;

/**
 * 改密碼（.scratch/pre-launch-hardening/issues/14，ASVS 2.1.5、2.1.6）：要目前的密碼；新密碼照註冊的規則；改好之後其他裝置的登入作廢，
 * 這次拿到新的一組 token。
 */
@SpringBootTest
@AutoConfigureTestGrpcTransport
@Import(PostgresContainerConfig.class)
class ChangePasswordTest {

    private static final String PASSWORD = "a-good-password";
    private static final String NEW_PASSWORD = "an even better password";

    @Autowired
    private GrpcChannelFactory channels;

    @Autowired
    private JdbcTemplate jdbc;

    @Test
    void theNewPasswordWorksAndTheOldOneNoLonger() {
        AuthResponse signedUp = register();

        AuthResponse changed = change(signedUp, PASSWORD, NEW_PASSWORD);

        assertThat(changed.getAccessToken()).isNotEmpty();
        assertThat(login(signedUp, NEW_PASSWORD)).isTrue();
        assertThat(login(signedUp, PASSWORD)).isFalse();
    }

    @Test
    void everyOtherSignInEndsButThisOneGetsFreshTokens() {
        AuthResponse signedUp = register();
        AuthResponse otherDevice = stub().login(LoginRequest.newBuilder()
                .setEmail(signedUp.getUser().getEmail()).setPassword(PASSWORD).build());

        AuthResponse changed = change(signedUp, PASSWORD, NEW_PASSWORD);

        assertCode(Status.Code.UNAUTHENTICATED, () -> refresh(otherDevice.getRefreshToken()));
        assertCode(Status.Code.UNAUTHENTICATED, () -> refresh(signedUp.getRefreshToken()));
        assertThat(refresh(changed.getRefreshToken()).getAccessToken()).isNotEmpty();
    }

    @Test
    void itSaysWhichSignInsEndedSoTheirAccessTokensCanBeStoppedToo() {
        AuthResponse signedUp = register();
        stub().login(LoginRequest.newBuilder().setEmail(signedUp.getUser().getEmail()).setPassword(PASSWORD).build());

        ChangePasswordResponse changed = stubAs(UUID.fromString(signedUp.getUser().getId())).changePassword(
                ChangePasswordRequest.newBuilder().setCurrentPassword(PASSWORD).setNewPassword(NEW_PASSWORD).build());

        assertThat(changed.getEndedSessionIdsList()).containsExactlyInAnyOrder(
                jdbc.queryForList("select distinct family_id::text from refresh_tokens where user_id = ?::uuid and revoked_at is not null",
                        String.class, signedUp.getUser().getId()).toArray(String[]::new))
                .hasSize(2);
    }

    @Test
    void aWrongCurrentPasswordChangesNothing() {
        AuthResponse signedUp = register();

        assertCode(Status.Code.PERMISSION_DENIED, () -> change(signedUp, "not the password", NEW_PASSWORD));

        assertThat(login(signedUp, PASSWORD)).isTrue();
        assertThat(refresh(signedUp.getRefreshToken()).getAccessToken()).isNotEmpty();  // still signed in
    }

    @Test
    void theNewPasswordFollowsTheSameRulesAsSigningUp() {
        AuthResponse signedUp = register();

        assertThatThrownBy(() -> change(signedUp, PASSWORD, "too short")).isInstanceOfSatisfying(StatusRuntimeException.class, e -> {
            assertThat(e.getStatus().getCode()).isEqualTo(Status.Code.INVALID_ARGUMENT);
            assertThat(e.getStatus().getDescription()).isEqualTo("密碼至少要 12 個字元");
        });
        assertThat(login(signedUp, PASSWORD)).isTrue();
    }

    @Test
    void theNewPasswordMustDifferFromTheCurrentOne() {
        AuthResponse signedUp = register();

        assertThatThrownBy(() -> change(signedUp, PASSWORD, PASSWORD)).isInstanceOfSatisfying(StatusRuntimeException.class, e -> {
            assertThat(e.getStatus().getCode()).isEqualTo(Status.Code.INVALID_ARGUMENT);
            assertThat(e.getStatus().getDescription()).isEqualTo("新密碼不能跟目前的密碼一樣");
        });
    }

    @Test
    void itNeedsToKnowWhoIsAsking() {
        assertCode(Status.Code.UNAUTHENTICATED, () -> stub().changePassword(ChangePasswordRequest.newBuilder()
                .setCurrentPassword(PASSWORD).setNewPassword(NEW_PASSWORD).build()));
    }

    private AuthResponse register() {
        return stub().register(RegisterRequest.newBuilder()
                .setEmail("user-" + UUID.randomUUID() + "@example.com").setPassword(PASSWORD).build());
    }

    private AuthResponse change(AuthResponse signedIn, String current, String next) {
        return stubAs(UUID.fromString(signedIn.getUser().getId())).changePassword(ChangePasswordRequest.newBuilder()
                .setCurrentPassword(current).setNewPassword(next).build()).getSignedIn();
    }

    private boolean login(AuthResponse signedIn, String password) {
        try {
            stub().login(LoginRequest.newBuilder().setEmail(signedIn.getUser().getEmail()).setPassword(password).build());
            return true;
        } catch (StatusRuntimeException e) {
            return false;
        }
    }

    private AuthResponse refresh(String refreshToken) {
        return stub().refresh(RefreshRequest.newBuilder().setRefreshToken(refreshToken).build());
    }

    private static void assertCode(Status.Code code, Runnable call) {
        assertThatThrownBy(call::run).isInstanceOfSatisfying(StatusRuntimeException.class,
                e -> assertThat(e.getStatus().getCode()).isEqualTo(code));
    }

    private AuthServiceGrpc.AuthServiceBlockingStub stub() {
        return AuthServiceGrpc.newBlockingStub(channels.createChannel("auth"));
    }

    private AuthServiceGrpc.AuthServiceBlockingStub stubAs(UUID userId) {
        Metadata headers = new Metadata();
        headers.put(Metadata.Key.of("x-user-id", Metadata.ASCII_STRING_MARSHALLER), userId.toString());
        return stub().withInterceptors(MetadataUtils.newAttachHeadersInterceptor(headers));
    }
}
