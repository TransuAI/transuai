package com.transuai.auth_service.security;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * @param refreshReuseGraceSeconds 已經換發過的 refresh token 在這幾秒內再被用一次不算被盜：前端的多個分頁共用同一個 refresh token，
 *        幾乎同時換發時第二個拿的是剛被換掉的舊 token
 * @param sessionMaxDays 一次登入最多維持幾天：一路換發也不會超過，之後要重新輸入密碼（ASVS 3.3.2）
 */
@ConfigurationProperties(prefix = "app.jwt")
public record JwtProperties(String secret, int accessTokenTtlMinutes, int refreshTokenTtlDays, int refreshReuseGraceSeconds,
        int sessionMaxDays) {
}
