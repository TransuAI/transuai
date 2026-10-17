package com.transuai.auth_service.security;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * 信裡給使用者點的連結（前端的網址，跟 gateway 的 {@code FRONTEND_URL} 同一個值）。重設 token 放在 # 後面：瀏覽器不會送到伺服器，
 * 也不會出現在存取紀錄或 Referer 裡；前端讀出來之後從網址拿掉。
 */
@Component
public class AuthLinks {

    private final String frontendUrl;

    public AuthLinks(@Value("${app.frontend-url}") String frontendUrl) {
        this.frontendUrl = frontendUrl.replaceAll("/+$", "");
    }

    public String passwordReset(String token) {
        return frontendUrl + "/reset-password#token=" + token;
    }

    public String emailVerification(String token) {
        return frontendUrl + "/verify-email#token=" + token;
    }
}
