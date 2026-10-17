package com.transuai.auth_service.config;

import java.util.Map;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.DelegatingPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.crypto.password.Pbkdf2PasswordEncoder;

@Configuration
public class SecurityConfig {

    /**
     * 新的雜湊用 PBKDF2-HMAC-SHA256（310,000 次）：bcrypt 只看密碼的前 72 個位元組（中文約 24 字），更長的會被截斷或拒絕
     * （ASVS 2.1.2、2.1.3）。存下來的雜湊帶 {@code {pbkdf2}} 前綴；之前沒有前綴的是 bcrypt，照樣認得，登入成功時換成新的
     * （見 AuthGrpcService.login）。
     */
    @Bean
    public PasswordEncoder passwordEncoder() {
        PasswordEncoder bcrypt = new LegacyBcrypt();
        DelegatingPasswordEncoder encoder = new DelegatingPasswordEncoder("pbkdf2", Map.of(
                "pbkdf2", Pbkdf2PasswordEncoder.defaultsForSpringSecurity_v5_8(),
                "bcrypt", bcrypt));
        encoder.setDefaultPasswordEncoderForMatches(bcrypt);
        return encoder;
    }

    // 超過 72 個位元組的密碼 bcrypt 直接拋例外；對舊的 bcrypt 雜湊來說那只是「不對」，不是伺服器錯誤。
    private static final class LegacyBcrypt implements PasswordEncoder {
        private final BCryptPasswordEncoder bcrypt = new BCryptPasswordEncoder();

        @Override
        public String encode(CharSequence rawPassword) {
            return bcrypt.encode(rawPassword);
        }

        @Override
        public boolean matches(CharSequence rawPassword, String encodedPassword) {
            try {
                return bcrypt.matches(rawPassword, encodedPassword);
            } catch (IllegalArgumentException e) {
                return false;
            }
        }
    }
}
