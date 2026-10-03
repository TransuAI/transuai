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
import com.transuai.auth.grpc.v1.DeleteAccountRequest;
import com.transuai.auth.grpc.v1.LoginRequest;
import com.transuai.auth.grpc.v1.RefreshRequest;
import com.transuai.auth.grpc.v1.RegisterRequest;
import com.transuai.auth_service.PostgresContainerConfig;

import io.grpc.Metadata;
import io.grpc.Status;
import io.grpc.StatusRuntimeException;
import io.grpc.stub.MetadataUtils;

/**
 * 刪除帳號（見 .scratch/account-deletion/issues/02）：再確認一次密碼；刪掉使用者與他的 refresh token，account.deleted 寫進 outbox
 * （送出在 OutboxPublisherTest）。這裡把 outbox 的排程調慢，outbox 的內容才看得到。
 */
@SpringBootTest(properties = "app.outbox.poll-interval=1h")
@AutoConfigureTestGrpcTransport
@Import(PostgresContainerConfig.class)
class DeleteAccountTest {

    private static final String PASSWORD = "a-good-password";

    @Autowired
    private GrpcChannelFactory channels;

    @Autowired
    private JdbcTemplate jdbc;

    @Test
    void theRightPasswordDeletesTheUserAndTheirRefreshTokensAndQueuesAccountDeleted() {
        AuthResponse signedUp = register();
        UUID userId = UUID.fromString(signedUp.getUser().getId());

        stubAs(userId).deleteAccount(DeleteAccountRequest.newBuilder().setPassword(PASSWORD).build());

        assertThat(jdbc.queryForObject("select count(*) from users where id = ?", Integer.class, userId)).isZero();
        assertThat(jdbc.queryForObject("select count(*) from refresh_tokens where user_id = ?", Integer.class, userId)).isZero();
        assertThat(jdbc.queryForObject("select count(*) from outbox_events where exchange = 'account.deleted' and payload = ?",
                Integer.class, "{\"userId\":\"" + userId + "\"}")).isOne();
        assertCode(Status.Code.UNAUTHENTICATED,
                () -> stub().refresh(RefreshRequest.newBuilder().setRefreshToken(signedUp.getRefreshToken()).build()));
        assertCode(Status.Code.UNAUTHENTICATED, () -> stub().login(LoginRequest.newBuilder()
                .setEmail(signedUp.getUser().getEmail()).setPassword(PASSWORD).build()));
    }

    @Test
    void aWrongPasswordIsPermissionDeniedAndDeletesNothing() {
        AuthResponse signedUp = register();
        UUID userId = UUID.fromString(signedUp.getUser().getId());

        assertCode(Status.Code.PERMISSION_DENIED,
                () -> stubAs(userId).deleteAccount(DeleteAccountRequest.newBuilder().setPassword("wrong-password").build()));

        assertThat(jdbc.queryForObject("select count(*) from users where id = ?", Integer.class, userId)).isOne();
        assertThat(jdbc.queryForObject("select count(*) from outbox_events where payload like ?", Integer.class,
                "%" + userId + "%")).isZero();
    }

    @Test
    void theSameEmailCanRegisterAgainAsANewAccount() {
        AuthResponse signedUp = register();
        UUID userId = UUID.fromString(signedUp.getUser().getId());
        stubAs(userId).deleteAccount(DeleteAccountRequest.newBuilder().setPassword(PASSWORD).build());

        AuthResponse again = stub().register(RegisterRequest.newBuilder()
                .setEmail(signedUp.getUser().getEmail()).setPassword(PASSWORD).build());

        assertThat(again.getUser().getId()).isNotEqualTo(userId.toString());
    }

    @Test
    void anUnknownUserIsNotFoundAndAMissingUserIdIsUnauthenticated() {
        assertCode(Status.Code.NOT_FOUND, () -> stubAs(UUID.randomUUID())
                .deleteAccount(DeleteAccountRequest.newBuilder().setPassword(PASSWORD).build()));
        assertCode(Status.Code.UNAUTHENTICATED,
                () -> stub().deleteAccount(DeleteAccountRequest.newBuilder().setPassword(PASSWORD).build()));
    }

    private AuthResponse register() {
        return stub().register(RegisterRequest.newBuilder()
                .setEmail("delete-" + UUID.randomUUID() + "@example.com").setPassword(PASSWORD).build());
    }

    private static void assertCode(Status.Code code, Runnable call) {
        assertThatThrownBy(call::run).isInstanceOfSatisfying(StatusRuntimeException.class,
                e -> assertThat(e.getStatus().getCode()).isEqualTo(code));
    }

    private AuthServiceGrpc.AuthServiceBlockingStub stub() {
        return AuthServiceGrpc.newBlockingStub(channels.createChannel("auth-service"));
    }

    private AuthServiceGrpc.AuthServiceBlockingStub stubAs(UUID userId) {
        Metadata headers = new Metadata();
        headers.put(Metadata.Key.of("x-user-id", Metadata.ASCII_STRING_MARSHALLER), userId.toString());
        return stub().withInterceptors(MetadataUtils.newAttachHeadersInterceptor(headers));
    }
}
