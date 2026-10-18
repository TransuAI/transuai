package com.transuai.auth_service.service;

import java.util.Locale;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.SmartInitializingSingleton;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

import com.transuai.auth_service.domain.User;
import com.transuai.auth_service.repository.UserRepository;
import com.transuai.auth_service.security.CommonPasswords;

/**
 * 安裝時建立的管理員（infra/deploy/install.sh 產生 {@code INITIAL_ADMIN_EMAIL}、{@code INITIAL_ADMIN_PASSWORD}，密碼印在畫面上）：還沒有任何
 * 帳號時建立它，標記「要先改密碼」。已經有帳號時什麼都不做，這兩個值之後就沒用了。沒設定時照舊——第一個註冊的帳號是管理員（開發環境）。
 *
 * <p>在所有 bean 好了、gRPC server 開始接受請求之前做（{@link SmartInitializingSingleton}），所以不會有人在這之前搶先註冊。跟註冊用同一個
 * advisory lock（見 {@link UserRepository#lockForFirstAccount}）。密碼不符合規則（12 字元以上、不是常見密碼）時不啟動，並說原因。
 */
@Component
public class InitialAdmin implements SmartInitializingSingleton {

    private static final Logger log = LoggerFactory.getLogger(InitialAdmin.class);
    // 跟註冊的密碼規則一樣（AuthGrpcService#passwordProblem）。
    private static final int MIN_PASSWORD_LENGTH = 12;

    private final UserRepository users;
    private final PasswordEncoder passwordEncoder;
    private final CommonPasswords commonPasswords;
    private final TransactionTemplate transactions;
    private final String email;
    private final String password;

    public InitialAdmin(UserRepository users, PasswordEncoder passwordEncoder, CommonPasswords commonPasswords,
            TransactionTemplate transactions,
            @Value("${app.initial-admin.email:}") String email,
            @Value("${app.initial-admin.password:}") String password) {
        this.users = users;
        this.passwordEncoder = passwordEncoder;
        this.commonPasswords = commonPasswords;
        this.transactions = transactions;
        this.email = email.trim().toLowerCase(Locale.ROOT);
        this.password = password;
    }

    @Override
    public void afterSingletonsInstantiated() {
        createIfNeeded();
    }

    /** 建立了就回 true。 */
    public boolean createIfNeeded() {
        if (email.isEmpty() && password.isEmpty()) {
            return false;
        }
        if (email.isEmpty() || !email.contains("@") || password.isEmpty()) {
            throw new IllegalStateException("INITIAL_ADMIN_EMAIL and INITIAL_ADMIN_PASSWORD must both be set (or neither)");
        }
        if (password.codePointCount(0, password.length()) < MIN_PASSWORD_LENGTH || commonPasswords.isTooCommon(password)) {
            throw new IllegalStateException("INITIAL_ADMIN_PASSWORD must be at least " + MIN_PASSWORD_LENGTH
                    + " characters and not a common password");
        }
        String passwordHash = passwordEncoder.encode(password);
        Boolean created = transactions.execute(status -> {
            users.lockForFirstAccount();
            if (users.count() > 0) {
                return false;
            }
            users.save(User.builder()
                    .email(email)
                    .passwordHash(passwordHash)
                    .displayName("管理員")
                    .role(User.ADMIN)
                    .mustChangePassword(true)
                    .build());
            return true;
        });
        if (Boolean.TRUE.equals(created)) {
            log.info("created the initial administrator {} (must change the password at first sign-in)", email);
        }
        return Boolean.TRUE.equals(created);
    }
}
