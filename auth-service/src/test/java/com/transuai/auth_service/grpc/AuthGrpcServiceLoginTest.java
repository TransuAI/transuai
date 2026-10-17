package com.transuai.auth_service.grpc;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.Optional;

import org.junit.jupiter.api.Test;
import org.springframework.security.crypto.password.PasswordEncoder;

import com.transuai.auth.grpc.v1.AuthResponse;
import com.transuai.auth.grpc.v1.LoginRequest;
import com.transuai.auth_service.config.SecurityConfig;
import com.transuai.auth_service.repository.UserRepository;
import com.transuai.auth_service.security.JwtService;
import com.transuai.auth_service.security.RefreshTokens;

import io.grpc.stub.StreamObserver;

class AuthGrpcServiceLoginTest {

    @Test
    @SuppressWarnings("unchecked")
    void anUnknownEmailStillHasAPasswordCheckedSoItTakesAsLongAsAWrongPassword() {
        UserRepository users = mock(UserRepository.class);
        when(users.findByEmail(any())).thenReturn(Optional.empty());
        // 真的 encoder：帳號不存在時比對的必須是一個真的雜湊，matches(密碼, null) 會立刻回 false，時間差就又出現了。
        PasswordEncoder encoder = spy(new SecurityConfig().passwordEncoder());
        StreamObserver<AuthResponse> observer = mock(StreamObserver.class);

        new AuthGrpcService(users, encoder, mock(JwtService.class), mock(RefreshTokens.class),
                mock(com.transuai.auth_service.service.AccountDeletion.class),
                mock(com.transuai.auth_service.security.CommonPasswords.class),
                mock(com.transuai.auth_service.security.PasswordResets.class),
                mock(com.transuai.auth_service.mail.AccountMail.class),
                mock(com.transuai.auth_service.security.AuthLinks.class),
                mock(com.transuai.auth_service.security.EmailVerifications.class),
                mock(com.transuai.auth_service.security.RecoveryCodes.class)).login(
                LoginRequest.newBuilder().setEmail("nobody@example.com").setPassword("guess").build(), observer);

        verify(encoder).matches(eq("guess"), argThat(hash -> hash != null && hash.startsWith("{pbkdf2}")));
        verify(observer).onError(any());
    }
}
