package com.transuai.gateway.web;

import java.util.UUID;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import com.transuai.auth.grpc.v1.AuthServiceGrpc;
import com.transuai.auth.grpc.v1.GetMailSettingsRequest;
import com.transuai.auth.grpc.v1.GetMeRequest;
import com.transuai.auth.grpc.v1.GetSystemStatusRequest;
import com.transuai.auth.grpc.v1.MailSettings;
import com.transuai.auth.grpc.v1.SendTestMailRequest;
import com.transuai.auth.grpc.v1.SendTestMailResponse;
import com.transuai.auth.grpc.v1.SystemStatus;
import com.transuai.auth.grpc.v1.UpdateMailSettingsRequest;
import com.transuai.gateway.grpc.GrpcMetadataSupport;
import com.transuai.gateway.web.dto.SystemSettingsDtos.AiSettingsCheckDto;
import com.transuai.gateway.web.dto.SystemSettingsDtos.AiSettingsDto;
import com.transuai.gateway.web.dto.SystemSettingsDtos.CheckDto;
import com.transuai.gateway.web.dto.SystemSettingsDtos.MailSettingsDto;
import com.transuai.gateway.web.dto.SystemSettingsDtos.SendTestMailDto;
import com.transuai.gateway.web.dto.SystemSettingsDtos.SpeechSettingsDto;
import com.transuai.gateway.web.dto.SystemSettingsDtos.SystemStatusDto;
import com.transuai.gateway.web.dto.SystemSettingsDtos.TestMailResultDto;
import com.transuai.gateway.web.dto.SystemSettingsDtos.UpdateAiSettingsDto;
import com.transuai.gateway.web.dto.SystemSettingsDtos.UpdateMailSettingsDto;
import com.transuai.gateway.web.dto.SystemSettingsDtos.UpdateSpeechSettingsDto;
import transuai.transcription.v1.Transcription.CheckSpeechSettingsRequest;
import transuai.transcription.v1.Transcription.GetSpeechSettingsRequest;
import transuai.transcription.v1.Transcription.SpeechSettings;
import transuai.transcription.v1.Transcription.SpeechSettingsCheck;
import transuai.transcription.v1.TranscriptionServiceGrpc;
import transuai.transcription.v1.Transcription.UpdateSpeechSettingsRequest;

import io.grpc.Status;
import lombok.RequiredArgsConstructor;
import transuai.ai.v1.Ai.AiSettings;
import transuai.ai.v1.Ai.AiSettingsCheck;
import transuai.ai.v1.Ai.CheckAiSettingsRequest;
import transuai.ai.v1.Ai.GetAiSettingsRequest;
import transuai.ai.v1.Ai.UpdateAiSettingsRequest;
import transuai.ai.v1.AiServiceGrpc;

/**
 * 系統設定（.scratch/system-settings/spec.md）：寄信（auth-service）、模型（ai-service）、語音辨識（transcription-service）各自存在
 * 各自的服務。{@code /admin/**} 只給管理員：每次先問 auth-service 這個人是不是（不是回 403）。{@code /system/status} 不用登入。
 */
@RestController
@RequiredArgsConstructor
public class SystemSettingsController {

    private final AuthServiceGrpc.AuthServiceBlockingStub authServiceStub;
    private final AiServiceGrpc.AiServiceBlockingStub aiServiceStub;
    private final TranscriptionServiceGrpc.TranscriptionServiceBlockingStub transcriptionServiceStub;

    @GetMapping("/system/status")
    public SystemStatusDto status() {
        SystemStatus status = authServiceStub.getSystemStatus(GetSystemStatusRequest.getDefaultInstance());
        return new SystemStatusDto(status.getSetupRequired(), status.getMailEnabled());
    }

    // --- 寄信（auth-service 自己也檢查是不是管理員） ---

    @GetMapping("/admin/settings/mail")
    public MailSettingsDto mail(@CurrentUserId UUID userId) {
        return toDto(asUser(userId).getMailSettings(GetMailSettingsRequest.getDefaultInstance()));
    }

    @PutMapping("/admin/settings/mail")
    public MailSettingsDto updateMail(@CurrentUserId UUID userId, @RequestBody UpdateMailSettingsDto body) {
        UpdateMailSettingsRequest.Builder request = UpdateMailSettingsRequest.newBuilder()
                .setUseEnvironment(Boolean.TRUE.equals(body.useEnvironment()))
                .setHost(orEmpty(body.host())).setPort(body.port() == null ? 0 : body.port())
                .setUsername(orEmpty(body.username())).setPassword(orEmpty(body.password()))
                .setClearPassword(Boolean.TRUE.equals(body.clearPassword())).setFrom(orEmpty(body.from()))
                .setStarttls(!Boolean.FALSE.equals(body.starttls())).setSmtpAuth(!Boolean.FALSE.equals(body.smtpAuth()));
        return toDto(asUser(userId).updateMailSettings(request.build()));
    }

    @PostMapping("/admin/settings/mail/test")
    public TestMailResultDto testMail(@CurrentUserId UUID userId, @RequestBody(required = false) SendTestMailDto body) {
        SendTestMailResponse response = asUser(userId).sendTestMail(
                SendTestMailRequest.newBuilder().setTo(body == null ? "" : orEmpty(body.to())).build());
        return new TestMailResultDto(response.getSent(), response.getError());
    }

    // --- 模型（ai-service） ---

    @GetMapping("/admin/settings/ai")
    public AiSettingsDto ai(@CurrentUserId UUID userId) {
        requireAdmin(userId);
        return toDto(aiServiceStub.getAiSettings(GetAiSettingsRequest.getDefaultInstance()));
    }

    @PutMapping("/admin/settings/ai")
    public AiSettingsDto updateAi(@CurrentUserId UUID userId, @RequestBody UpdateAiSettingsDto body) {
        requireAdmin(userId);
        UpdateAiSettingsRequest.Builder request = UpdateAiSettingsRequest.newBuilder()
                .setUseEnvironment(Boolean.TRUE.equals(body.useEnvironment()))
                .setPlatformBaseUrl(orEmpty(body.platformBaseUrl())).setPlatformModel(orEmpty(body.platformModel()))
                .setPostMeetingModel(orEmpty(body.postMeetingModel())).setEmbeddingBaseUrl(orEmpty(body.embeddingBaseUrl()))
                .setEmbeddingModel(orEmpty(body.embeddingModel()))
                .setEmbeddingQueryInstruction(orEmpty(body.embeddingQueryInstruction()));
        if (body.platformApiKey() != null) {
            request.setPlatformApiKey(body.platformApiKey());
        }
        if (body.embeddingApiKey() != null) {
            request.setEmbeddingApiKey(body.embeddingApiKey());
        }
        if (body.webSearchApiKey() != null) {
            request.setWebSearchApiKey(body.webSearchApiKey());
        }
        return toDto(aiServiceStub.updateAiSettings(request.build()));
    }

    @PostMapping("/admin/settings/ai/check")
    public AiSettingsCheckDto checkAi(@CurrentUserId UUID userId) {
        requireAdmin(userId);
        AiSettingsCheck check = aiServiceStub.checkAiSettings(CheckAiSettingsRequest.getDefaultInstance());
        return new AiSettingsCheckDto(check.getPlatformOk(), check.getPlatformDetail(), check.getEmbeddingOk(),
                check.getEmbeddingDetail());
    }

    // --- 語音辨識（transcription-service） ---

    @GetMapping("/admin/settings/speech")
    public SpeechSettingsDto speech(@CurrentUserId UUID userId) {
        requireAdmin(userId);
        return toDto(transcriptionServiceStub.getSpeechSettings(GetSpeechSettingsRequest.getDefaultInstance()));
    }

    @PutMapping("/admin/settings/speech")
    public SpeechSettingsDto updateSpeech(@CurrentUserId UUID userId, @RequestBody UpdateSpeechSettingsDto body) {
        requireAdmin(userId);
        UpdateSpeechSettingsRequest.Builder request = UpdateSpeechSettingsRequest.newBuilder()
                .setUseEnvironment(Boolean.TRUE.equals(body.useEnvironment()))
                .setSttBaseUrl(orEmpty(body.sttBaseUrl())).setSttModel(orEmpty(body.sttModel()))
                .setDiarizationThreshold(body.diarizationThreshold() == null ? 0.6 : body.diarizationThreshold());
        if (body.sttApiKey() != null) {
            request.setSttApiKey(body.sttApiKey());
        }
        if (body.deepgramApiKey() != null) {
            request.setDeepgramApiKey(body.deepgramApiKey());
        }
        return toDto(transcriptionServiceStub.updateSpeechSettings(request.build()));
    }

    @PostMapping("/admin/settings/speech/check")
    public CheckDto checkSpeech(@CurrentUserId UUID userId) {
        requireAdmin(userId);
        SpeechSettingsCheck check = transcriptionServiceStub.checkSpeechSettings(CheckSpeechSettingsRequest.getDefaultInstance());
        return new CheckDto(check.getOk(), check.getDetail());
    }

    /** 不是管理員：PERMISSION_DENIED，由 GrpcExceptionAdvice 轉成 403。 */
    private void requireAdmin(UUID userId) {
        if (!asUser(userId).getMe(GetMeRequest.getDefaultInstance()).getIsAdmin()) {
            throw Status.PERMISSION_DENIED.withDescription("only an administrator can change system settings").asRuntimeException();
        }
    }

    private AuthServiceGrpc.AuthServiceBlockingStub asUser(UUID userId) {
        return GrpcMetadataSupport.withUserId(authServiceStub, userId);
    }

    private static String orEmpty(String value) {
        return value == null ? "" : value;
    }

    private static MailSettingsDto toDto(MailSettings s) {
        return new MailSettingsDto(s.getHost(), s.getPort(), s.getUsername(), s.getPasswordSet(), s.getFrom(), s.getStarttls(),
                s.getSmtpAuth(), s.getFromEnvironment(), s.getEnabled());
    }

    private static AiSettingsDto toDto(AiSettings s) {
        return new AiSettingsDto(s.getPlatformBaseUrl(), s.getPlatformApiKeySet(), s.getPlatformModel(), s.getPostMeetingModel(),
                s.getEmbeddingBaseUrl(), s.getEmbeddingApiKeySet(), s.getEmbeddingModel(), s.getEmbeddingQueryInstruction(),
                s.getWebSearchApiKeySet(), s.getFromEnvironment());
    }

    private static SpeechSettingsDto toDto(SpeechSettings s) {
        return new SpeechSettingsDto(s.getSttBaseUrl(), s.getSttApiKeySet(), s.getSttModel(), s.getDeepgramApiKeySet(),
                s.getDiarizationThreshold(), s.getFromEnvironment(), s.getDiarizationAvailable(), s.getActive());
    }
}
