package com.transuai.auth_service.grpc;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

import org.springframework.grpc.server.service.GrpcService;
import org.springframework.security.crypto.password.PasswordEncoder;

import com.transuai.auth.grpc.v1.AuthResponse;
import com.transuai.auth.grpc.v1.AuthServiceGrpc;
import com.transuai.auth.grpc.v1.ChangePasswordRequest;
import com.transuai.auth.grpc.v1.ChangePasswordResponse;
import com.transuai.auth.grpc.v1.DeleteAccountRequest;
import com.transuai.auth.grpc.v1.DeleteAccountResponse;
import com.transuai.auth.grpc.v1.GenerateRecoveryCodesRequest;
import com.transuai.auth.grpc.v1.GenerateRecoveryCodesResponse;
import com.transuai.auth.grpc.v1.GetMeRequest;
import com.transuai.auth.grpc.v1.LoginRequest;
import com.transuai.auth.grpc.v1.LogoutAllDevicesRequest;
import com.transuai.auth.grpc.v1.LogoutRequest;
import com.transuai.auth.grpc.v1.LogoutResponse;
import com.transuai.auth.grpc.v1.RefreshRequest;
import com.transuai.auth.grpc.v1.RegisterRequest;
import com.transuai.auth.grpc.v1.RequestPasswordResetRequest;
import com.transuai.auth.grpc.v1.RequestPasswordResetResponse;
import com.transuai.auth.grpc.v1.ResendEmailVerificationRequest;
import com.transuai.auth.grpc.v1.ResendEmailVerificationResponse;
import com.transuai.auth.grpc.v1.ResetPasswordRequest;
import com.transuai.auth.grpc.v1.ResetPasswordResponse;
import com.transuai.auth.grpc.v1.ResetPasswordWithRecoveryCodeRequest;
import com.transuai.auth.grpc.v1.User;
import com.transuai.auth.grpc.v1.VerifyEmailRequest;
import com.transuai.auth.grpc.v1.VerifyEmailResponse;
import com.transuai.auth_service.grpc.auth.GrpcAuthContext;
import com.transuai.auth_service.repository.UserRepository;
import com.transuai.auth_service.mail.AccountMail;
import com.transuai.auth_service.security.AuthLinks;
import com.transuai.auth_service.security.CommonPasswords;
import com.transuai.auth_service.security.EmailVerifications;
import com.transuai.auth_service.security.JwtService;
import com.transuai.auth_service.security.PasswordResets;
import com.transuai.auth_service.security.RecoveryCodes;
import com.transuai.auth_service.security.RefreshTokens;
import com.transuai.auth_service.service.AccountDeletion;

import io.grpc.Status;
import io.grpc.stub.StreamObserver;
import lombok.RequiredArgsConstructor;

@GrpcService
@RequiredArgsConstructor
public class AuthGrpcService extends AuthServiceGrpc.AuthServiceImplBase {

    // ASVS 2.1.1、2.1.2：至少 12 字元，最多 128 字元（以字元算，中文與 emoji 一個算一個）；不限制要有哪些種類的字元。
    private static final int MIN_PASSWORD_LENGTH = 12;
    private static final int MAX_PASSWORD_LENGTH = 128;

    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final JwtService jwtService;
    private final RefreshTokens refreshTokens;
    private final AccountDeletion accountDeletion;
    private final CommonPasswords commonPasswords;
    private final PasswordResets passwordResets;
    private final AccountMail accountMail;
    private final AuthLinks links;
    private final EmailVerifications emailVerifications;
    private final RecoveryCodes recoveryCodes;
    private final org.springframework.transaction.support.TransactionTemplate transactions;
    private final com.transuai.auth_service.mail.MailSettingsAdmin mailSettings;
    // 帳號不存在時也拿密碼比對這個雜湊，回應時間才跟「密碼錯」一樣長，不能用來猜哪些 email 註冊過。第一次用到才產生
    // （跟真的密碼用同一個 encoder、同樣的成本）。
    private volatile String unknownUserHash;

    @Override
    public void register(RegisterRequest request, StreamObserver<AuthResponse> responseObserver) {
        String email = request.getEmail().trim().toLowerCase(Locale.ROOT);
        if (email.isBlank() || !email.contains("@")) {
            responseObserver.onError(Status.INVALID_ARGUMENT
                    .withDescription("email must be a valid email address").asRuntimeException());
            return;
        }
        String passwordProblem = passwordProblem(request.getPassword());
        if (passwordProblem != null) {
            responseObserver.onError(Status.INVALID_ARGUMENT.withDescription(passwordProblem).asRuntimeException());
            return;
        }
        if (userRepository.existsByEmail(email)) {
            responseObserver.onError(
                    Status.ALREADY_EXISTS.withDescription("email already registered").asRuntimeException());
            return;
        }

        String passwordHash = passwordEncoder.encode(request.getPassword());
        // 還沒有任何帳號時，這個帳號是管理員（全新安裝的第一個人）。鎖住判斷，同時註冊的兩個人只有一個是。
        com.transuai.auth_service.domain.User user = transactions.execute(status -> {
            userRepository.lockForFirstAccount();
            boolean first = userRepository.count() == 0;
            return userRepository.save(com.transuai.auth_service.domain.User.builder()
                    .email(email)
                    .passwordHash(passwordHash)
                    .displayName(request.getDisplayName().isBlank() ? null : request.getDisplayName())
                    .role(first ? com.transuai.auth_service.domain.User.ADMIN : com.transuai.auth_service.domain.User.MEMBER)
                    .build());
        });
        sendEmailVerification(user);

        responseObserver.onNext(buildAuthResponse(user, refreshTokens.issue(user.getId())));
        responseObserver.onCompleted();
    }

    @Override
    public void login(LoginRequest request, StreamObserver<AuthResponse> responseObserver) {
        String email = request.getEmail().trim().toLowerCase(Locale.ROOT);
        com.transuai.auth_service.domain.User user = userRepository.findByEmail(email).orElse(null);
        // 帳號不存在跟密碼錯誤回同一種錯誤、花一樣的時間，避免帳號列舉。
        String hash = user == null ? unknownUserHash() : user.getPasswordHash();
        if (!passwordEncoder.matches(request.getPassword(), hash) || user == null) {
            responseObserver.onError(
                    Status.UNAUTHENTICATED.withDescription("invalid email or password").asRuntimeException());
            return;
        }
        // 舊的 bcrypt 雜湊：密碼對了，順便換成現在的雜湊方式。
        if (passwordEncoder.upgradeEncoding(hash)) {
            user.setPasswordHash(passwordEncoder.encode(request.getPassword()));
            user = userRepository.save(user);
        }

        responseObserver.onNext(buildAuthResponse(user, refreshTokens.issue(user.getId())));
        responseObserver.onCompleted();
    }

    @Override
    public void refresh(RefreshRequest request, StreamObserver<AuthResponse> responseObserver) {
        RefreshTokens.Exchange exchange = refreshTokens.exchange(request.getRefreshToken());
        com.transuai.auth_service.domain.User user = userRepository.findById(exchange.userId()).orElse(null);
        if (user == null) {
            responseObserver.onError(
                    Status.UNAUTHENTICATED.withDescription("user no longer exists").asRuntimeException());
            return;
        }

        responseObserver.onNext(buildAuthResponse(user, exchange.issued()));
        responseObserver.onCompleted();
    }

    @Override
    public void logout(LogoutRequest request, StreamObserver<LogoutResponse> responseObserver) {
        LogoutResponse.Builder response = LogoutResponse.newBuilder();
        refreshTokens.logout(request.getRefreshToken()).ifPresent(sessionId -> response.setSessionId(sessionId.toString()));
        responseObserver.onNext(response.build());
        responseObserver.onCompleted();
    }

    @Override
    public void logoutAllDevices(LogoutAllDevicesRequest request, StreamObserver<LogoutResponse> responseObserver) {
        List<UUID> ended = refreshTokens.logoutAll(GrpcAuthContext.currentUserId());
        responseObserver.onNext(LogoutResponse.newBuilder()
                .addAllEndedSessionIds(ended.stream().map(UUID::toString).toList()).build());
        responseObserver.onCompleted();
    }

    // 刪除帳號前再確認一次密碼：開著的瀏覽器被別人拿到也刪不掉帳號。密碼錯是 PERMISSION_DENIED（Gateway 回 403），不是
    // UNAUTHENTICATED——那會讓前端以為 token 過期、去換發再重試。
    @Override
    public void deleteAccount(DeleteAccountRequest request, StreamObserver<DeleteAccountResponse> responseObserver) {
        UUID userId = GrpcAuthContext.currentUserId();
        com.transuai.auth_service.domain.User user = userRepository.findById(userId).orElse(null);
        if (user == null) {
            responseObserver.onError(Status.NOT_FOUND.withDescription("user not found").asRuntimeException());
            return;
        }
        if (!passwordEncoder.matches(request.getPassword(), user.getPasswordHash())) {
            responseObserver.onError(
                    Status.PERMISSION_DENIED.withDescription("wrong password").asRuntimeException());
            return;
        }

        accountDeletion.delete(userId);
        responseObserver.onNext(DeleteAccountResponse.getDefaultInstance());
        responseObserver.onCompleted();
    }

    // 改密碼：要目前的密碼（ASVS 2.1.6；錯了是 PERMISSION_DENIED，理由同 deleteAccount）。改好之後其他裝置的登入全部作廢——
    // 改密碼常常是因為懷疑被盜用——這次的請求拿到新的一串。
    @Override
    public void changePassword(ChangePasswordRequest request, StreamObserver<ChangePasswordResponse> responseObserver) {
        UUID userId = GrpcAuthContext.currentUserId();
        com.transuai.auth_service.domain.User user = userRepository.findById(userId).orElse(null);
        if (user == null) {
            responseObserver.onError(Status.NOT_FOUND.withDescription("user not found").asRuntimeException());
            return;
        }
        if (!passwordEncoder.matches(request.getCurrentPassword(), user.getPasswordHash())) {
            responseObserver.onError(
                    Status.PERMISSION_DENIED.withDescription("wrong password").asRuntimeException());
            return;
        }
        String passwordProblem = passwordProblem(request.getNewPassword());
        if (passwordProblem != null) {
            responseObserver.onError(Status.INVALID_ARGUMENT.withDescription(passwordProblem).asRuntimeException());
            return;
        }
        // 安裝時產生的密碼一定要換掉（要改密碼的帳號），一般改密碼也一樣：換成同一個等於沒換。
        if (request.getNewPassword().equals(request.getCurrentPassword())) {
            responseObserver.onError(Status.INVALID_ARGUMENT.withDescription("新密碼不能跟目前的密碼一樣").asRuntimeException());
            return;
        }

        // 先作廢再改：中途失敗頂多是被登出，不會留下改了密碼、舊的登入卻還能用的情況。
        List<UUID> ended = refreshTokens.logoutAll(userId);
        user.setPasswordHash(passwordEncoder.encode(request.getNewPassword()));
        user.setMustChangePassword(false);
        user = userRepository.save(user);
        accountMail.passwordChanged(user.getEmail(), Instant.now());
        responseObserver.onNext(ChangePasswordResponse.newBuilder()
                .setSignedIn(buildAuthResponse(user, refreshTokens.issue(userId)))
                .addAllEndedSessionIds(ended.stream().map(UUID::toString).toList())
                .build());
        responseObserver.onCompleted();
    }

    // 忘記密碼：有這個帳號就寄重設連結；沒有也一樣回成功（不透露 email 有沒有註冊）。信在背景寄，回應時間不因為有帳號而變長。
    // 沒有設定寄信時整個功能不能用（UNAVAILABLE，跟 email 無關，所以也不透露什麼）。
    @Override
    public void requestPasswordReset(RequestPasswordResetRequest request,
            StreamObserver<RequestPasswordResetResponse> responseObserver) {
        if (!accountMail.available()) {
            responseObserver.onError(Status.UNAVAILABLE
                    .withDescription("這個系統沒有設定寄信，不能用「忘記密碼」；請洽管理這套系統的人員重設密碼").asRuntimeException());
            return;
        }
        String email = request.getEmail().trim().toLowerCase(Locale.ROOT);
        // 只寄給確認過的 email：沒確認的地址可能根本不是這個人的，寄重設連結過去等於把帳號交給那個信箱的主人。
        userRepository.findByEmail(email).filter(user -> user.getEmailVerifiedAt() != null)
                .ifPresent(user -> accountMail.passwordResetLink(user.getEmail(),
                        links.passwordReset(passwordResets.issue(user.getId())), passwordResets.ttl().toMinutes()));
        responseObserver.onNext(RequestPasswordResetResponse.getDefaultInstance());
        responseObserver.onCompleted();
    }

    // 重設密碼：新密碼先照規則檢查（不合就不用掉連結），再用掉 token；成功後這位使用者的登入全部作廢（gateway 也擋下 access token）、
    // 寄通知信。連結無效、過期、用過了是 FAILED_PRECONDITION。
    @Override
    public void resetPassword(ResetPasswordRequest request, StreamObserver<ResetPasswordResponse> responseObserver) {
        String passwordProblem = passwordProblem(request.getNewPassword());
        if (passwordProblem != null) {
            responseObserver.onError(Status.INVALID_ARGUMENT.withDescription(passwordProblem).asRuntimeException());
            return;
        }
        com.transuai.auth_service.domain.User user = passwordResets.useUp(request.getToken())
                .flatMap(userRepository::findById).orElse(null);
        if (user == null) {
            responseObserver.onError(Status.FAILED_PRECONDITION
                    .withDescription("這個重設連結無效或已過期，請重新申請").asRuntimeException());
            return;
        }

        List<UUID> ended = refreshTokens.logoutAll(user.getId());
        user.setPasswordHash(passwordEncoder.encode(request.getNewPassword()));
        user.setMustChangePassword(false);
        user = userRepository.save(user);
        accountMail.passwordWasReset(user.getEmail(), Instant.now());
        responseObserver.onNext(ResetPasswordResponse.newBuilder()
                .setUserId(user.getId().toString())
                .addAllEndedSessionIds(ended.stream().map(UUID::toString).toList())
                .build());
        responseObserver.onCompleted();
    }

    // ASVS 2.1.1、2.1.2、2.1.7：以字元算（中文與 emoji 一個算一個），不在常見密碼清單裡；不限制要有哪些種類的字元。null：可以用。
    private String passwordProblem(String password) {
        int length = password.codePointCount(0, password.length());
        if (length < MIN_PASSWORD_LENGTH) {
            return "密碼至少要 " + MIN_PASSWORD_LENGTH + " 個字元";
        }
        if (length > MAX_PASSWORD_LENGTH) {
            return "密碼最多 " + MAX_PASSWORD_LENGTH + " 個字元";
        }
        if (commonPasswords.isTooCommon(password)) {
            return "這個密碼太常見，很容易被猜到，請換一個";
        }
        return null;
    }

    @Override
    public void getSystemStatus(com.transuai.auth.grpc.v1.GetSystemStatusRequest request,
            StreamObserver<com.transuai.auth.grpc.v1.SystemStatus> responseObserver) {
        responseObserver.onNext(com.transuai.auth.grpc.v1.SystemStatus.newBuilder()
                .setSetupRequired(userRepository.count() == 0)
                .setMailEnabled(accountMail.available())
                .build());
        responseObserver.onCompleted();
    }

    @Override
    public void getMailSettings(com.transuai.auth.grpc.v1.GetMailSettingsRequest request,
            StreamObserver<com.transuai.auth.grpc.v1.MailSettings> responseObserver) {
        if (!requireAdmin(responseObserver)) {
            return;
        }
        responseObserver.onNext(mailSettings.current());
        responseObserver.onCompleted();
    }

    @Override
    public void updateMailSettings(com.transuai.auth.grpc.v1.UpdateMailSettingsRequest request,
            StreamObserver<com.transuai.auth.grpc.v1.MailSettings> responseObserver) {
        if (!requireAdmin(responseObserver)) {
            return;
        }
        if (!request.getUseEnvironment() && request.getPort() < 0) {
            responseObserver.onError(Status.INVALID_ARGUMENT.withDescription("port must be positive").asRuntimeException());
            return;
        }
        try {
            responseObserver.onNext(mailSettings.update(request));
            responseObserver.onCompleted();
        } catch (com.transuai.auth_service.mail.MailSettingsAdmin.NoEncryptionKey e) {
            responseObserver.onError(Status.FAILED_PRECONDITION.withDescription(e.getMessage()).asRuntimeException());
        }
    }

    @Override
    public void sendTestMail(com.transuai.auth.grpc.v1.SendTestMailRequest request,
            StreamObserver<com.transuai.auth.grpc.v1.SendTestMailResponse> responseObserver) {
        com.transuai.auth_service.domain.User admin = requireAdminUser(responseObserver);
        if (admin == null) {
            return;
        }
        String to = request.getTo().isBlank() ? admin.getEmail() : request.getTo().trim();
        String error = accountMail.sendTest(to);
        responseObserver.onNext(com.transuai.auth.grpc.v1.SendTestMailResponse.newBuilder()
                .setSent(error == null).setError(error == null ? "" : error).build());
        responseObserver.onCompleted();
    }

    /** 系統設定只給管理員：不是的話回 PERMISSION_DENIED，回傳 false。 */
    private boolean requireAdmin(StreamObserver<?> responseObserver) {
        return requireAdminUser(responseObserver) != null;
    }

    private com.transuai.auth_service.domain.User requireAdminUser(StreamObserver<?> responseObserver) {
        com.transuai.auth_service.domain.User user = userRepository.findById(GrpcAuthContext.currentUserId()).orElse(null);
        if (user == null || !user.isAdmin()) {
            responseObserver.onError(Status.PERMISSION_DENIED.withDescription("only an administrator can change system settings")
                    .asRuntimeException());
            return null;
        }
        return user;
    }

    @Override
    public void getMe(GetMeRequest request, StreamObserver<User> responseObserver) {
        UUID userId = GrpcAuthContext.currentUserId();
        com.transuai.auth_service.domain.User user = userRepository.findById(userId).orElse(null);
        if (user == null) {
            responseObserver.onError(Status.NOT_FOUND.withDescription("user not found").asRuntimeException());
            return;
        }

        responseObserver.onNext(UserMapper.toProto(user, recoveryCodes.left(user.getId())));
        responseObserver.onCompleted();
    }

    @Override
    public void verifyEmail(VerifyEmailRequest request, StreamObserver<VerifyEmailResponse> responseObserver) {
        com.transuai.auth_service.domain.User user = emailVerifications.useUp(request.getToken())
                .flatMap(userRepository::findById).orElse(null);
        if (user == null) {
            responseObserver.onError(Status.FAILED_PRECONDITION
                    .withDescription("這個確認連結無效或已過期，請到設定頁重寄確認信").asRuntimeException());
            return;
        }
        if (user.getEmailVerifiedAt() == null) {
            user.setEmailVerifiedAt(OffsetDateTime.now(ZoneOffset.UTC));
            userRepository.save(user);
        }
        responseObserver.onNext(VerifyEmailResponse.getDefaultInstance());
        responseObserver.onCompleted();
    }

    @Override
    public void resendEmailVerification(ResendEmailVerificationRequest request,
            StreamObserver<ResendEmailVerificationResponse> responseObserver) {
        com.transuai.auth_service.domain.User user = userRepository.findById(GrpcAuthContext.currentUserId()).orElse(null);
        if (user == null) {
            responseObserver.onError(Status.NOT_FOUND.withDescription("user not found").asRuntimeException());
            return;
        }
        if (user.getEmailVerifiedAt() == null && !accountMail.available()) {
            responseObserver.onError(Status.UNAVAILABLE
                    .withDescription("這個系統沒有設定寄信，不能寄確認信").asRuntimeException());
            return;
        }
        sendEmailVerification(user);
        responseObserver.onNext(ResendEmailVerificationResponse.getDefaultInstance());
        responseObserver.onCompleted();
    }

    // 復原碼要目前的密碼才能產生（錯了 PERMISSION_DENIED，理由同 deleteAccount）；舊的作廢，寄通知信。
    @Override
    public void generateRecoveryCodes(GenerateRecoveryCodesRequest request,
            StreamObserver<GenerateRecoveryCodesResponse> responseObserver) {
        com.transuai.auth_service.domain.User user = userRepository.findById(GrpcAuthContext.currentUserId()).orElse(null);
        if (user == null) {
            responseObserver.onError(Status.NOT_FOUND.withDescription("user not found").asRuntimeException());
            return;
        }
        if (!passwordEncoder.matches(request.getCurrentPassword(), user.getPasswordHash())) {
            responseObserver.onError(Status.PERMISSION_DENIED.withDescription("wrong password").asRuntimeException());
            return;
        }
        List<String> codes = recoveryCodes.generate(user.getId());
        accountMail.recoveryCodesGenerated(user.getEmail(), Instant.now());
        responseObserver.onNext(GenerateRecoveryCodesResponse.newBuilder().addAllCodes(codes).build());
        responseObserver.onCompleted();
    }

    // 忘記密碼的另一條路（ASVS 2.5.6）：email＋一組復原碼。email 或復原碼不對都是同一個錯誤（不透露有沒有這個帳號）。
    @Override
    public void resetPasswordWithRecoveryCode(ResetPasswordWithRecoveryCodeRequest request,
            StreamObserver<ResetPasswordResponse> responseObserver) {
        String passwordProblem = passwordProblem(request.getNewPassword());
        if (passwordProblem != null) {
            responseObserver.onError(Status.INVALID_ARGUMENT.withDescription(passwordProblem).asRuntimeException());
            return;
        }
        String email = request.getEmail().trim().toLowerCase(Locale.ROOT);
        com.transuai.auth_service.domain.User user = userRepository.findByEmail(email)
                .filter(found -> recoveryCodes.useUp(found.getId(), request.getCode())).orElse(null);
        if (user == null) {
            responseObserver.onError(Status.FAILED_PRECONDITION
                    .withDescription("email 或復原碼不對，或這組復原碼已經用過了").asRuntimeException());
            return;
        }

        List<UUID> ended = refreshTokens.logoutAll(user.getId());
        user.setPasswordHash(passwordEncoder.encode(request.getNewPassword()));
        user.setMustChangePassword(false);
        user = userRepository.save(user);
        accountMail.passwordResetWithRecoveryCode(user.getEmail(), Instant.now());
        responseObserver.onNext(ResetPasswordResponse.newBuilder()
                .setUserId(user.getId().toString())
                .addAllEndedSessionIds(ended.stream().map(UUID::toString).toList())
                .build());
        responseObserver.onCompleted();
    }

    // 有設定寄信、還沒確認的才寄（沒有寄信的部署不要求確認，也沒辦法確認）。
    private void sendEmailVerification(com.transuai.auth_service.domain.User user) {
        if (user.getEmailVerifiedAt() == null && accountMail.available()) {
            accountMail.emailVerificationLink(user.getEmail(),
                    links.emailVerification(emailVerifications.issue(user.getId())), emailVerifications.ttl().toHours());
        }
    }

    private String unknownUserHash() {
        if (unknownUserHash == null) {
            unknownUserHash = passwordEncoder.encode(UUID.randomUUID().toString());
        }
        return unknownUserHash;
    }

    private AuthResponse buildAuthResponse(com.transuai.auth_service.domain.User user, RefreshTokens.Issued issued) {
        return AuthResponse.newBuilder()
                .setAccessToken(jwtService.issueAccessToken(user.getId(), user.getEmail(), issued.sessionId(),
                        user.isMustChangePassword()))
                .setRefreshToken(issued.refreshToken())
                .setUser(UserMapper.toProto(user, recoveryCodes.left(user.getId())))
                .build();
    }
}
