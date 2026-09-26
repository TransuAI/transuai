package com.transuai.gateway.security;

import java.io.IOException;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;

import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import com.fasterxml.jackson.databind.ObjectMapper;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

/**
 * 沒有拉整個 Spring Security（那是給要做 form login / CSRF / 多種 filter chain 的情境），
 * 這個 Gateway 只需要「驗 JWT、解出 user id」，一個 OncePerRequestFilter 就夠。
 * 驗證通過後把 user id 放進 request attribute，controller 用 {@link com.transuai.gateway.web.CurrentUserId}
 * 參數解析取得，不用每支 method 自己重複解 header。
 * <p>
 * ObjectMapper 這裡故意自己 new 一個、不用 Spring autowire 注入 JacksonAutoConfiguration
 * 產生的那顆——{@code @Component} 型別是 {@link jakarta.servlet.Filter} 的 bean 會在
 * {@code ServletWebServerApplicationContext.onRefresh()} 建立內嵌 Tomcat 時被提早解析
 * （早於一般 singleton 初始化順序），這時候 JacksonAutoConfiguration 的 ObjectMapper bean
 * 還沒建立，會直接炸 UnsatisfiedDependencyException（開發時實測踩到）。這裡只是序列化一個
 * 兩欄位的錯誤訊息，不需要專案自訂的 Jackson module，自己 new 最單純。
 */
@Component
public class JwtAuthenticationFilter extends OncePerRequestFilter {

    public static final String USER_ID_ATTRIBUTE = "userId";

    private static final String BEARER_PREFIX = "Bearer ";

    // Register/Login/Refresh 呼叫時使用者還沒有 token，這三條路徑不驗證。
    private static final Set<String> PUBLIC_PATHS = Set.of("/auth/register", "/auth/login", "/auth/refresh");
    // Google / Notion 把瀏覽器轉回來時不會帶我們的 token；使用者由 state 與綁定瀏覽器的 cookie 認出來（見 ConnectionController）。
    private static final Pattern OAUTH_CALLBACK = Pattern.compile("/oauth/[^/]+/callback");

    private final JwtService jwtService;
    private final ObjectMapper objectMapper = new ObjectMapper();

    public JwtAuthenticationFilter(JwtService jwtService) {
        this.jwtService = jwtService;
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        String path = request.getRequestURI();
        return PUBLIC_PATHS.contains(path) || OAUTH_CALLBACK.matcher(path).matches() || path.startsWith("/v3/api-docs")
                || path.startsWith("/swagger-ui");
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
            FilterChain filterChain) throws ServletException, IOException {
        String header = request.getHeader("Authorization");
        if (header == null || !header.startsWith(BEARER_PREFIX)) {
            writeUnauthorized(response, "missing or malformed Authorization header");
            return;
        }

        UUID userId;
        try {
            userId = jwtService.validateAccessToken(header.substring(BEARER_PREFIX.length()));
        } catch (InvalidTokenException e) {
            writeUnauthorized(response, e.getMessage());
            return;
        }

        request.setAttribute(USER_ID_ATTRIBUTE, userId);
        filterChain.doFilter(request, response);
    }

    private void writeUnauthorized(HttpServletResponse response, String message) throws IOException {
        response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        objectMapper.writeValue(response.getWriter(), new ErrorBody("UNAUTHENTICATED", message));
    }

    private record ErrorBody(String error, String message) {
    }
}
