package com.transuai.auth_service.grpc;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.grpc.test.autoconfigure.AutoConfigureTestGrpcTransport;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.grpc.client.GrpcChannelFactory;

import com.transuai.auth.grpc.v1.AuthResponse;
import com.transuai.auth.grpc.v1.AuthServiceGrpc;
import com.transuai.auth.grpc.v1.RefreshRequest;
import com.transuai.auth.grpc.v1.RegisterRequest;
import com.transuai.auth_service.PostgresContainerConfig;

/**
 * 同時換發的寬限：前端每個分頁共用同一個 refresh token，兩個分頁幾乎同時換發時，第二個拿的是剛被換掉的舊 token——不能當成被盜。
 */
@SpringBootTest
@AutoConfigureTestGrpcTransport
@Import(PostgresContainerConfig.class)
class RefreshTokenGraceTest {

    @Autowired
    private GrpcChannelFactory channels;

    @Test
    void twoTabsRefreshingAtOnceBothGetTokensAndNothingIsRevoked() {
        AuthServiceGrpc.AuthServiceBlockingStub stub = AuthServiceGrpc.newBlockingStub(channels.createChannel("auth"));
        AuthResponse signedUp = stub.register(RegisterRequest.newBuilder()
                .setEmail("user-" + UUID.randomUUID() + "@example.com").setPassword("a-good-password").build());

        AuthResponse firstTab = stub.refresh(RefreshRequest.newBuilder().setRefreshToken(signedUp.getRefreshToken()).build());
        AuthResponse secondTab = stub.refresh(RefreshRequest.newBuilder().setRefreshToken(signedUp.getRefreshToken()).build());

        assertThat(stub.refresh(RefreshRequest.newBuilder().setRefreshToken(firstTab.getRefreshToken()).build())
                .getAccessToken()).isNotEmpty();
        assertThat(stub.refresh(RefreshRequest.newBuilder().setRefreshToken(secondTab.getRefreshToken()).build())
                .getAccessToken()).isNotEmpty();
    }
}
