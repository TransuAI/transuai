package com.transuai.gateway.security;

import java.time.Duration;
import java.util.Arrays;
import java.util.Optional;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseCookie;
import org.springframework.stereotype.Component;

import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

/**
 * refresh token 放在 httpOnly cookie，前端的 JavaScript 讀不到（XSS 偷不走）；access token 只在回應本文裡，前端放在記憶體。
 * SameSite=Strict：別的網站發起的請求不會帶這個 cookie（換發、登出不會被跨站偽造）——所以前端跟 API 要在同一個網站
 *（同一個網域，或同一個網域底下的子網域），見 README。名稱用 {@code __Host-} 前綴（ASVS 3.4.4）：瀏覽器只收 Secure、Path=/、
 * 沒有 Domain 的，別的子網域設不了同名的 cookie 來蓋掉它；代價是每個請求都會帶（仍是 httpOnly、SameSite=Strict，gateway 只在換發與
 * 登出時讀）。有效時間跟 auth-service 的 refresh token 一樣（同一個環境變數）。
 * 這個 Gateway 一樣不解析 refresh token，只是放進 cookie、從 cookie 拿出來轉給 auth-service。
 */
@Component
public class RefreshTokenCookie {

    public static final String NAME = "__Host-refresh_token";

    private final Duration maxAge;

    public RefreshTokenCookie(@Value("${app.auth.refresh-cookie.max-age}") Duration maxAge) {
        this.maxAge = maxAge;
    }

    public void set(HttpServletResponse response, String refreshToken) {
        write(response, refreshToken, maxAge);
    }

    public void clear(HttpServletResponse response) {
        write(response, "", Duration.ZERO);
    }

    public Optional<String> read(HttpServletRequest request) {
        Cookie[] cookies = request.getCookies();
        if (cookies == null) {
            return Optional.empty();
        }
        return Arrays.stream(cookies)
                .filter(cookie -> NAME.equals(cookie.getName()) && !cookie.getValue().isBlank())
                .map(Cookie::getValue)
                .findFirst();
    }

    private void write(HttpServletResponse response, String value, Duration age) {
        ResponseCookie cookie = ResponseCookie.from(NAME, value)
                .httpOnly(true)
                .secure(true)
                .sameSite("Strict")
                .path("/")
                .maxAge(age)
                .build();
        response.addHeader(HttpHeaders.SET_COOKIE, cookie.toString());
    }
}
