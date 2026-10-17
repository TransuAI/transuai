package com.transuai.auth_service.grpc;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.grpc.test.autoconfigure.AutoConfigureTestGrpcTransport;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.grpc.client.GrpcChannelFactory;

import com.transuai.auth.grpc.v1.AuthServiceGrpc;
import com.transuai.auth.grpc.v1.RequestPasswordResetRequest;
import com.transuai.auth_service.PostgresContainerConfig;

import io.grpc.Status;
import io.grpc.StatusRuntimeException;

/** 沒有設定寄信（SMTP_HOST 空的）：忘記密碼不能用，說原因（跟 email 無關，不透露有沒有這個帳號）。 */
@SpringBootTest
@AutoConfigureTestGrpcTransport
@Import(PostgresContainerConfig.class)
class PasswordResetWithoutMailTest {

    @Autowired
    private GrpcChannelFactory channels;

    @Test
    void forgotPasswordSaysItIsNotAvailable() {
        assertThatThrownBy(() -> AuthServiceGrpc.newBlockingStub(channels.createChannel("auth"))
                .requestPasswordReset(RequestPasswordResetRequest.newBuilder().setEmail("a@example.com").build()))
                .isInstanceOfSatisfying(StatusRuntimeException.class, e -> {
                    assertThat(e.getStatus().getCode()).isEqualTo(Status.Code.UNAVAILABLE);
                    assertThat(e.getStatus().getDescription()).contains("沒有設定寄信");
                });
    }
}
