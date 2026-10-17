package com.transuai.auth_service.service;

import java.util.UUID;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.transuai.auth_service.domain.OutboxEventEntity;
import com.transuai.auth_service.repository.OutboxEventRepository;
import com.transuai.auth_service.repository.PasswordResetTokenRepository;
import com.transuai.auth_service.repository.RefreshTokenRepository;
import com.transuai.auth_service.repository.UserRepository;

/**
 * 刪除帳號：使用者與他所有的 refresh token，並在同一個交易裡把 account.deleted 寫進 outbox（OutboxPublisher 送出），其他服務收到後
 * 清掉他的資料。帳號一刪，同一個 email 馬上可以重新註冊（是全新的帳號）。
 */
@Service
public class AccountDeletion {

    private final UserRepository users;
    private final RefreshTokenRepository refreshTokens;
    private final PasswordResetTokenRepository passwordResetTokens;
    private final OutboxEventRepository outbox;
    private final String exchange;

    public AccountDeletion(UserRepository users, RefreshTokenRepository refreshTokens,
            PasswordResetTokenRepository passwordResetTokens, OutboxEventRepository outbox,
            @Value("${app.mq.account-deleted-exchange}") String exchange) {
        this.users = users;
        this.refreshTokens = refreshTokens;
        this.passwordResetTokens = passwordResetTokens;
        this.outbox = outbox;
        this.exchange = exchange;
    }

    @Transactional
    public void delete(UUID userId) {
        refreshTokens.deleteByUserId(userId);
        passwordResetTokens.deleteByUserId(userId);
        users.deleteById(userId);
        outbox.save(OutboxEventEntity.builder()
                .exchange(exchange)
                .payload(payload(userId))
                .build());
    }

    // account.deleted { userId }：其他服務清掉（或去識別化）他的資料。UUID 只有十六進位與減號，不用跳脫。
    static String payload(UUID userId) {
        return "{\"userId\":\"" + userId + "\"}";
    }
}
