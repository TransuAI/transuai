package com.transuai.gateway.ratelimit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

import com.transuai.auth.grpc.v1.AuthServiceGrpc;
import com.transuai.gateway.RedisContainerConfig;

import io.grpc.Status;

/**
 * 使用者自己填的 X-Forwarded-For 不能換掉限流看的來源 IP（否則每次換一個假 IP 就能無限猜密碼）。要真的 Tomcat：
 * 處理這個標頭的是 Tomcat 的 RemoteIpValve，MockMvc 不會經過它。
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
        "app.rate-limit.login-failures.limit=3", "app.rate-limit.login-failures.window=15m",
})
@Import(RedisContainerConfig.class)
class ForwardedAddressTest {

    @LocalServerPort
    private int port;

    @MockitoBean
    private AuthServiceGrpc.AuthServiceBlockingStub authServiceStub;

    @Test
    void aForwardedForHeaderFromTheClientDoesNotChangeTheAddress() throws Exception {
        when(authServiceStub.login(any())).thenThrow(
                Status.UNAUTHENTICATED.withDescription("invalid email or password").asRuntimeException());
        HttpClient client = HttpClient.newHttpClient();
        int last = 0;
        for (int i = 0; i < 4; i++) {
            HttpRequest request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + "/auth/login"))
                    .header("Content-Type", "application/json")
                    .header("X-Forwarded-For", "203.0.113." + i)  // a different made-up address each time
                    .POST(HttpRequest.BodyPublishers.ofString(
                            "{\"email\":\"forwarded@example.com\",\"password\":\"wrong\"}"))
                    .build();
            last = client.send(request, HttpResponse.BodyHandlers.discarding()).statusCode();
        }

        assertThat(last).isEqualTo(429);
    }
}
