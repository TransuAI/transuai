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
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;

import com.transuai.auth.grpc.v1.AuthServiceGrpc;
import com.transuai.auth.grpc.v1.LoginRequest;
import com.transuai.auth.grpc.v1.RegisterRequest;
import com.transuai.auth_service.PostgresContainerConfig;

import io.grpc.Status;
import io.grpc.StatusRuntimeException;

/**
 * 密碼的規則（ASVS 2.1.1–2.1.4）：12 到 128 個字元（以字元算），任何字元都可以，不截斷；舊的 bcrypt 雜湊照樣能登入，登入時換成新的。
 */
@SpringBootTest
@AutoConfigureTestGrpcTransport
@Import(PostgresContainerConfig.class)
class PasswordPolicyTest {

    @Autowired
    private GrpcChannelFactory channels;

    @Autowired
    private JdbcTemplate jdbc;

    @Test
    void aPasswordNeedsAtLeastTwelveCharacters() {
        assertInvalidArgument(() -> register(newEmail(), "elevenchars"), "密碼至少要 12 個字元");

        register(newEmail(), "twelve chars");
    }

    @Test
    void aPasswordCanBeUpToOneHundredTwentyEightCharactersOfAnyKind() {
        register(newEmail(), "密".repeat(128));
        register(newEmail(), "😀 ".repeat(6));  // 12 characters, though 18 UTF-16 units

        assertInvalidArgument(() -> register(newEmail(), "a".repeat(129)), "密碼最多 128 個字元");
    }

    @Test
    void aLongPasswordIsNotTruncated() {
        String email = newEmail();
        String password = "這是一個很長的密碼".repeat(10);  // 90 characters, 270 bytes: far past bcrypt's 72
        register(email, password);

        assertThat(login(email, password)).isTrue();
        assertThat(login(email, password.substring(0, 24))).isFalse();  // the first 72 bytes
    }

    @Test
    void anAccountFromBeforeStillSignsInAndItsHashIsUpgraded() {
        String email = newEmail();
        String password = "an older password";
        register(email, "a placeholder password");
        jdbc.update("update users set password_hash = ? where email = ?", new BCryptPasswordEncoder().encode(password), email);

        assertThat(login(email, password)).isTrue();

        assertThat(jdbc.queryForObject("select password_hash from users where email = ?", String.class, email))
                .startsWith("{pbkdf2}");
        assertThat(login(email, password)).isTrue();
        assertThat(login(email, password + "x".repeat(80))).isFalse();  // bcrypt would have thrown past 72 bytes
    }

    private void register(String email, String password) {
        stub().register(RegisterRequest.newBuilder().setEmail(email).setPassword(password).build());
    }

    private boolean login(String email, String password) {
        try {
            stub().login(LoginRequest.newBuilder().setEmail(email).setPassword(password).build());
            return true;
        } catch (StatusRuntimeException e) {
            assertThat(e.getStatus().getCode()).isEqualTo(Status.Code.UNAUTHENTICATED);
            return false;
        }
    }

    private static String newEmail() {
        return "user-" + UUID.randomUUID() + "@example.com";
    }

    private static void assertInvalidArgument(Runnable call, String message) {
        assertThatThrownBy(call::run).isInstanceOfSatisfying(StatusRuntimeException.class, e -> {
            assertThat(e.getStatus().getCode()).isEqualTo(Status.Code.INVALID_ARGUMENT);
            assertThat(e.getStatus().getDescription()).isEqualTo(message);
        });
    }

    private AuthServiceGrpc.AuthServiceBlockingStub stub() {
        return AuthServiceGrpc.newBlockingStub(channels.createChannel("auth"));
    }
}
