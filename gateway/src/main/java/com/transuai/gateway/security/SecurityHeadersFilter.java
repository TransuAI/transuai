package com.transuai.gateway.security;

import java.io.IOException;

import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpHeaders;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

/**
 * 每個 API 回應都帶的安全標頭（ASVS 8.2.1、14.4.2–14.4.7）：回應都是某個使用者的資料，不讓瀏覽器或中間的代理快取；不讓瀏覽器猜類型、
 * 不能被嵌進別的網頁、離開時不帶網址。最先執行，被 JWT filter 擋下的 401／429 也有。
 * <p>
 * HSTS 不在這裡：要由終結 TLS 的反向代理加（gateway 自己不跑 HTTPS），見 infra 的部署清單。前端頁面的 CSP 也由提供前端檔案的伺服器加。
 * 開發環境的 Swagger UI 要跑自己的 script，那兩條路徑不加 CSP 與 attachment（正式環境本來就關掉）。
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class SecurityHeadersFilter extends OncePerRequestFilter {

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
            throws ServletException, IOException {
        response.setHeader("X-Content-Type-Options", "nosniff");
        response.setHeader(HttpHeaders.CACHE_CONTROL, "no-store");
        response.setHeader("X-Frame-Options", "DENY");
        response.setHeader("Referrer-Policy", "no-referrer");
        String path = request.getRequestURI();
        if (!path.startsWith("/swagger-ui") && !path.startsWith("/v3/api-docs")) {
            response.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
            response.setHeader(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"api.json\"");
        }
        filterChain.doFilter(request, response);
    }
}
