package com.transuai.auth_service.grpc;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.charset.StandardCharsets;
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
import com.transuai.auth.grpc.v1.LoginRequest;
import com.transuai.auth.grpc.v1.LogoutAllDevicesRequest;
import com.transuai.auth.grpc.v1.LogoutRequest;
import com.transuai.auth.grpc.v1.RefreshRequest;
import com.transuai.auth.grpc.v1.RegisterRequest;
import com.transuai.auth_service.PostgresContainerConfig;
import com.transuai.auth_service.security.JwtProperties;

import io.grpc.Metadata;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import io.grpc.Status;
import io.grpc.StatusRuntimeException;
import io.grpc.stub.MetadataUtils;

/**
 * refresh token 可以作廢（見 .scratch/pre-launch-hardening/issues/08）：每次換發就輪替、舊的作廢；作廢的再被用一次視為被盜，整串作廢；
 * 可以登出、登出所有裝置。這裡把「同時換發的寬限」設成 0，寬限另外在 {@link RefreshTokenGraceTest}。
 */
@SpringBootTest(properties = "app.jwt.refresh-reuse-grace-seconds=0")
@AutoConfigureTestGrpcTransport
@Import(PostgresContainerConfig.class)
class RefreshTokenTest {

    private static final String PASSWORD = "a-good-password";

    @Autowired
    private GrpcChannelFactory channels;

    @Autowired
    private JdbcTemplate jdbc;

    @Autowired
    private JwtProperties jwt;

    @Test
    void refreshingGivesANewTokenAndTheOldOneStopsWorking() {
        AuthResponse signedUp = register();

        AuthResponse refreshed = refresh(signedUp.getRefreshToken());

        assertThat(refreshed.getRefreshToken()).isNotEqualTo(signedUp.getRefreshToken());
        assertUnauthenticated(() -> refresh(signedUp.getRefreshToken()));
    }

    @Test
    void usingARotatedTokenAgainRevokesEverythingThatCameFromIt() {
        AuthResponse signedUp = register();
        AuthResponse refreshed = refresh(signedUp.getRefreshToken());

        assertUnauthenticated(() -> refresh(signedUp.getRefreshToken()));  // 被盜的舊 token

        assertUnauthenticated(() -> refresh(refreshed.getRefreshToken()));  // 正主的新 token 也跟著作廢
    }

    @Test
    void anotherSignInIsNotAffectedByAReusedToken() {
        AuthResponse signedUp = register();
        AuthResponse otherDevice = stub().login(LoginRequest.newBuilder()
                .setEmail(signedUp.getUser().getEmail()).setPassword(PASSWORD).build());
        refresh(signedUp.getRefreshToken());

        assertUnauthenticated(() -> refresh(signedUp.getRefreshToken()));

        assertThat(refresh(otherDevice.getRefreshToken()).getAccessToken()).isNotEmpty();
    }

    @Test
    void afterLoggingOutTheRefreshTokenStopsWorking() {
        AuthResponse signedUp = register();
        AuthResponse refreshed = refresh(signedUp.getRefreshToken());

        stub().logout(LogoutRequest.newBuilder().setRefreshToken(refreshed.getRefreshToken()).build());

        assertUnauthenticated(() -> refresh(refreshed.getRefreshToken()));
    }

    @Test
    void loggingOutWithATokenThatIsNoLongerValidStillSucceeds() {
        assertThat(stub().logout(LogoutRequest.newBuilder().setRefreshToken("not-a-token").build()).getSessionId()).isEmpty();
    }

    // .scratch/pre-launch-hardening/issues/18：access token 帶這次登入的 id（sid），換發也一樣；登出時回傳它，gateway 才能讓那些
    // access token 馬上失效。
    @Test
    void theAccessTokenCarriesTheSignInItCameFromAndLoggingOutSaysWhichOneEnded() {
        AuthResponse signedUp = register();
        String sessionId = sessionOf(signedUp.getAccessToken());
        assertThat(jdbc.queryForObject("select family_id::text from refresh_tokens where user_id = ?::uuid",
                String.class, signedUp.getUser().getId())).isEqualTo(sessionId);

        AuthResponse refreshed = refresh(signedUp.getRefreshToken());
        assertThat(sessionOf(refreshed.getAccessToken())).isEqualTo(sessionId);

        assertThat(stub().logout(LogoutRequest.newBuilder().setRefreshToken(refreshed.getRefreshToken()).build())
                .getSessionId()).isEqualTo(sessionId);
        AuthResponse again = stub().login(LoginRequest.newBuilder()
                .setEmail(signedUp.getUser().getEmail()).setPassword(PASSWORD).build());
        assertThat(sessionOf(again.getAccessToken())).isNotEqualTo(sessionId);
    }

    private String sessionOf(String accessToken) {
        return Jwts.parser().verifyWith(Keys.hmacShaKeyFor(jwt.secret().getBytes(StandardCharsets.UTF_8))).build()
                .parseSignedClaims(accessToken).getPayload().get("sid", String.class);
    }

    @Test
    void loggingOutOfAllDevicesStopsEverySignIn() {
        AuthResponse signedUp = register();
        AuthResponse otherDevice = stub().login(LoginRequest.newBuilder()
                .setEmail(signedUp.getUser().getEmail()).setPassword(PASSWORD).build());

        stubAs(UUID.fromString(signedUp.getUser().getId())).logoutAllDevices(LogoutAllDevicesRequest.getDefaultInstance());

        assertUnauthenticated(() -> refresh(signedUp.getRefreshToken()));
        assertUnauthenticated(() -> refresh(otherDevice.getRefreshToken()));
    }

    @Test
    void loggingOutOfAllDevicesNeedsToKnowWhoIsAsking() {
        assertUnauthenticated(() -> stub().logoutAllDevices(LogoutAllDevicesRequest.getDefaultInstance()));
    }

    @Test
    void aSignInLastsAtMostThirtyDaysHoweverOftenItIsRefreshed() {
        AuthResponse signedUp = register();
        String userId = signedUp.getUser().getId();
        assertThat(jdbc.queryForObject(
                "select family_expires_at between now() + interval '29 days 23 hours' and now() + interval '30 days 1 hour'"
                        + " from refresh_tokens where user_id = ?::uuid", Boolean.class, userId)).isTrue();
        // Near the end of the sign-in: the next token can't outlive it, so it has to sign in again then.
        jdbc.update("update refresh_tokens set family_expires_at = now() + interval '1 hour' where user_id = ?::uuid", userId);

        refresh(signedUp.getRefreshToken());

        assertThat(jdbc.queryForObject(
                "select bool_and(expires_at <= now() + interval '1 hour' and family_expires_at <= now() + interval '1 hour')"
                        + " from refresh_tokens where user_id = ?::uuid and revoked_at is null", Boolean.class, userId)).isTrue();
    }

    @Test
    void onlyAHashOfTheTokenIsStored() {
        AuthResponse signedUp = register();

        assertThat(jdbc.queryForList("select token_hash from refresh_tokens", String.class))
                .isNotEmpty()
                .noneMatch(stored -> stored.equals(signedUp.getRefreshToken()));
    }

    private AuthResponse register() {
        return stub().register(RegisterRequest.newBuilder()
                .setEmail("user-" + UUID.randomUUID() + "@example.com").setPassword(PASSWORD).build());
    }

    private AuthResponse refresh(String refreshToken) {
        return stub().refresh(RefreshRequest.newBuilder().setRefreshToken(refreshToken).build());
    }

    private static void assertUnauthenticated(Runnable call) {
        assertThatThrownBy(call::run).isInstanceOfSatisfying(StatusRuntimeException.class,
                e -> assertThat(e.getStatus().getCode()).isEqualTo(Status.Code.UNAUTHENTICATED));
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
