package com.transuai.auth_service.grpc;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.Optional;

import org.junit.jupiter.api.Test;
import org.springframework.security.crypto.password.PasswordEncoder;

import com.transuai.auth.grpc.v1.AuthResponse;
import com.transuai.auth.grpc.v1.LoginRequest;
import com.transuai.auth_service.repository.UserRepository;
import com.transuai.auth_service.security.JwtService;

import io.grpc.stub.StreamObserver;

class AuthGrpcServiceLoginTest {

    @Test
    @SuppressWarnings("unchecked")
    void anUnknownEmailStillHasAPasswordCheckedSoItTakesAsLongAsAWrongPassword() {
        UserRepository users = mock(UserRepository.class);
        when(users.findByEmail(any())).thenReturn(Optional.empty());
        PasswordEncoder encoder = mock(PasswordEncoder.class);
        StreamObserver<AuthResponse> observer = mock(StreamObserver.class);

        new AuthGrpcService(users, encoder, mock(JwtService.class)).login(
                LoginRequest.newBuilder().setEmail("nobody@example.com").setPassword("guess").build(), observer);

        verify(encoder).matches(eq("guess"), any());
        verify(observer).onError(any());
    }
}
