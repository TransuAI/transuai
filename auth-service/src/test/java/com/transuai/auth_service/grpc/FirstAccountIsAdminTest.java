package com.transuai.auth_service.grpc;

import static org.assertj.core.api.Assertions.assertThat;

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
import com.transuai.auth.grpc.v1.GetMeRequest;
import com.transuai.auth.grpc.v1.GetSystemStatusRequest;
import com.transuai.auth.grpc.v1.RegisterRequest;
import com.transuai.auth_service.PostgresContainerConfig;

import io.grpc.Metadata;
import io.grpc.stub.MetadataUtils;

/** 全新安裝：第一個註冊的帳號是管理員，之後的都不是；登入前的頁面看得到「還沒有任何帳號」與「有沒有寄信」。 */
@SpringBootTest
@AutoConfigureTestGrpcTransport
@Import(PostgresContainerConfig.class)
class FirstAccountIsAdminTest {

    @Autowired
    private GrpcChannelFactory channels;

    @Autowired
    private JdbcTemplate jdbc;

    private AuthServiceGrpc.AuthServiceBlockingStub stub;

    @BeforeEach
    void freshInstall() {
        jdbc.execute("TRUNCATE users CASCADE");
        stub = AuthServiceGrpc.newBlockingStub(channels.createChannel("auth"));
    }

    @Test
    void theFirstAccountIsTheAdminAndTheNextIsNot() {
        assertThat(stub.getSystemStatus(GetSystemStatusRequest.getDefaultInstance()).getSetupRequired()).isTrue();

        var first = stub.register(register("first-" + UUID.randomUUID() + "@example.com"));
        var second = stub.register(register("second-" + UUID.randomUUID() + "@example.com"));

        assertThat(first.getUser().getIsAdmin()).isTrue();
        assertThat(second.getUser().getIsAdmin()).isFalse();
        assertThat(me(first.getUser().getId()).getIsAdmin()).isTrue();
        assertThat(stub.getSystemStatus(GetSystemStatusRequest.getDefaultInstance()).getSetupRequired()).isFalse();
    }

    @Test
    void withoutMailTheStatusSaysSo() {
        // The tests run without SMTP_HOST (see PasswordResetWithoutMailTest).
        assertThat(stub.getSystemStatus(GetSystemStatusRequest.getDefaultInstance()).getMailEnabled()).isFalse();
    }

    private static RegisterRequest register(String email) {
        return RegisterRequest.newBuilder().setEmail(email).setPassword("a-good-password").build();
    }

    private com.transuai.auth.grpc.v1.User me(String userId) {
        Metadata headers = new Metadata();
        headers.put(Metadata.Key.of("x-user-id", Metadata.ASCII_STRING_MARSHALLER), userId);
        return stub.withInterceptors(MetadataUtils.newAttachHeadersInterceptor(headers)).getMe(GetMeRequest.getDefaultInstance());
    }
}
