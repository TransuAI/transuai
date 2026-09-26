package com.transuai.gateway.web;

import java.net.URI;
import java.security.SecureRandom;
import java.time.Duration;
import java.util.Base64;
import java.util.List;
import java.util.UUID;
import java.util.regex.Pattern;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseCookie;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.CookieValue;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.util.UriComponentsBuilder;

import com.transuai.gateway.grpc.GrpcTimestamps;
import com.transuai.gateway.web.dto.AuthorizeUrlDto;
import com.transuai.gateway.web.dto.ConnectionDto;
import com.transuai.gateway.web.dto.DeleteConnectionResponseDto;

import io.grpc.StatusRuntimeException;
import lombok.extern.slf4j.Slf4j;
import transuai.ai.v1.Ai.CompleteConnectionRequest;
import transuai.ai.v1.Ai.Connection;
import transuai.ai.v1.Ai.DeleteConnectionRequest;
import transuai.ai.v1.Ai.ListConnectionsRequest;
import transuai.ai.v1.Ai.StartConnectionRequest;
import transuai.ai.v1.AiServiceGrpc;

// 已連結的帳號（見 ai-service/CONTEXT.md）：OAuth 的權杖、state、PKCE 都在 ai-service；這裡只負責瀏覽器那一端——給前端授權
// 網址，以及接住 Google / Notion 的回呼、再把使用者轉回設定頁。
//
// 回呼沒有 JWT，使用者靠 state 認出來；state 另外綁定開始連結的瀏覽器：開始時放一個隨機值進 HttpOnly cookie（ai-service
// 只存它的雜湊），回呼時要帶回同一個值。不然別人可以用自己的帳號開始連結，把授權網址丟給使用者按同意，使用者的 Google /
// Notion 就連到別人的帳號上了。cookie 是 SameSite=Lax：從 Google / Notion 轉回來的頂層 GET 會帶上。
@Slf4j
@RestController
public class ConnectionController {

    private static final String BINDING_COOKIE = "transuai_oauth_binding";
    private static final Duration BINDING_LIFETIME = Duration.ofMinutes(10); // ai-service 的授權也是 10 分鐘內有效
    // 轉回設定頁時只放認得出格式的服務名稱，不把網址上任意的字串帶回前端。
    private static final Pattern SERVICE_ID = Pattern.compile("[a-z]{1,16}");
    private static final SecureRandom RANDOM = new SecureRandom();

    private final AiServiceGrpc.AiServiceBlockingStub aiServiceStub;
    private final String callbackBaseUrl;
    private final String frontendUrl;

    public ConnectionController(AiServiceGrpc.AiServiceBlockingStub aiServiceStub,
            @Value("${app.oauth.callback-base-url}") String callbackBaseUrl,
            @Value("${app.frontend-url}") String frontendUrl) {
        this.aiServiceStub = aiServiceStub;
        this.callbackBaseUrl = callbackBaseUrl;
        this.frontendUrl = frontendUrl;
    }

    @GetMapping("/me/connections")
    public List<ConnectionDto> listConnections(@CurrentUserId UUID userId) {
        return aiServiceStub.listConnections(ListConnectionsRequest.newBuilder().setUserId(userId.toString()).build())
                .getConnectionsList().stream()
                .map(ConnectionController::toDto)
                .toList();
    }

    // 回傳要把使用者轉過去的 Google / Notion 授權網址（不是 302：前端的 JWT 在 header 裡，瀏覽器轉址帶不過來）。
    // 不支援的服務回 400；伺服器沒設定 Google OAuth client 回 409；連不上 Notion 回 503。
    @GetMapping("/me/connections/{service}/authorize")
    public ResponseEntity<AuthorizeUrlDto> authorize(@CurrentUserId UUID userId, @PathVariable String service) {
        byte[] bytes = new byte[32];
        RANDOM.nextBytes(bytes);
        String binding = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        String authorizeUrl = aiServiceStub.startConnection(StartConnectionRequest.newBuilder()
                .setUserId(userId.toString())
                .setService(service)
                .setRedirectUri(callbackUrl(service))
                .setBrowserBinding(binding)
                .build()).getAuthorizeUrl();
        return ResponseEntity.ok()
                .header(HttpHeaders.SET_COOKIE, bindingCookie(binding, BINDING_LIFETIME).toString())
                .body(new AuthorizeUrlDto(authorizeUrl));
    }

    // Google / Notion 把瀏覽器轉回來（沒有 JWT，使用者由 state 認出來）。不論成敗都轉回設定頁，由前端顯示結果；
    // 失敗原因只記 log，不放進網址。
    @GetMapping("/oauth/{service}/callback")
    public ResponseEntity<Void> callback(@PathVariable String service,
            @RequestParam(required = false, defaultValue = "") String state,
            @RequestParam(required = false, defaultValue = "") String code,
            @RequestParam(required = false, defaultValue = "") String error,
            @CookieValue(name = BINDING_COOKIE, required = false, defaultValue = "") String binding) {
        String result;
        try {
            aiServiceStub.completeConnection(CompleteConnectionRequest.newBuilder()
                    .setService(service).setState(state).setCode(code).setError(error).setBrowserBinding(binding)
                    .build());
            result = "connected";
        } catch (StatusRuntimeException e) {
            log.warn("linking {} failed: {}", service, e.getStatus());
            result = "connection_failed";
        }
        URI settings = UriComponentsBuilder.fromUriString(frontendUrl).path("/settings")
                .queryParam(result, SERVICE_ID.matcher(service).matches() ? service : "unknown").build().encode().toUri();
        return ResponseEntity.status(HttpStatus.FOUND).location(settings)
                .header(HttpHeaders.SET_COOKIE, bindingCookie("", Duration.ZERO).toString()) // used up either way
                .build();
    }

    // 向 Google / Notion 撤銷授權並刪除權杖；撤銷失敗時權杖照樣刪除，revoked 是 false。
    @DeleteMapping("/me/connections/{service}")
    public DeleteConnectionResponseDto deleteConnection(@CurrentUserId UUID userId, @PathVariable String service) {
        return new DeleteConnectionResponseDto(aiServiceStub.deleteConnection(DeleteConnectionRequest.newBuilder()
                .setUserId(userId.toString())
                .setService(service)
                .build()).getRevoked());
    }

    private ResponseCookie bindingCookie(String value, Duration maxAge) {
        return ResponseCookie.from(BINDING_COOKIE, value)
                .httpOnly(true)
                .secure(callbackBaseUrl.startsWith("https://"))
                .sameSite("Lax")
                .path("/")
                .maxAge(maxAge)
                .build();
    }

    private String callbackUrl(String service) {
        return UriComponentsBuilder.fromUriString(callbackBaseUrl).path("/oauth/{service}/callback")
                .buildAndExpand(service).toUriString();
    }

    private static ConnectionDto toDto(Connection connection) {
        return new ConnectionDto(connection.getService(),
                connection.getStatus().name().replace("CONNECTION_STATUS_", ""),
                connection.hasConnectedAt() ? GrpcTimestamps.toInstant(connection.getConnectedAt()) : null);
    }
}
