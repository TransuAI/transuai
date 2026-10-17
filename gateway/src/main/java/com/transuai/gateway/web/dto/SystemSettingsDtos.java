package com.transuai.gateway.web.dto;

/**
 * 系統設定頁（只給管理員）與登入前的系統狀態。金鑰類欄位只回「有沒有設定」；送來時 null（或沒給）是不改、空字串是清掉。
 */
public final class SystemSettingsDtos {

    private SystemSettingsDtos() {
    }

    /** 登入前的頁面用：還沒有任何帳號（下一個註冊的就是管理員）、有沒有設定寄信。 */
    public record SystemStatusDto(boolean setupRequired, boolean mailEnabled) {
    }

    public record MailSettingsDto(String host, int port, String username, boolean passwordSet, String from,
            boolean starttls, boolean smtpAuth, boolean fromEnvironment, boolean enabled) {
    }

    public record UpdateMailSettingsDto(String host, Integer port, String username, String password, Boolean clearPassword,
            String from, Boolean starttls, Boolean smtpAuth, Boolean useEnvironment) {
    }

    public record SendTestMailDto(String to) {
    }

    public record TestMailResultDto(boolean sent, String error) {
    }

    public record AiSettingsDto(String platformBaseUrl, boolean platformApiKeySet, String platformModel,
            String postMeetingModel, String embeddingBaseUrl, boolean embeddingApiKeySet, String embeddingModel,
            String embeddingQueryInstruction, boolean webSearchApiKeySet, boolean fromEnvironment) {
    }

    public record UpdateAiSettingsDto(String platformBaseUrl, String platformApiKey, String platformModel,
            String postMeetingModel, String embeddingBaseUrl, String embeddingApiKey, String embeddingModel,
            String embeddingQueryInstruction, String webSearchApiKey, Boolean useEnvironment) {
    }

    public record AiSettingsCheckDto(boolean platformOk, String platformDetail, boolean embeddingOk, String embeddingDetail) {
    }

    public record SpeechSettingsDto(String sttBaseUrl, boolean sttApiKeySet, String sttModel, boolean deepgramApiKeySet,
            double diarizationThreshold, boolean fromEnvironment, boolean diarizationAvailable, String active) {
    }

    public record UpdateSpeechSettingsDto(String sttBaseUrl, String sttApiKey, String sttModel, String deepgramApiKey,
            Double diarizationThreshold, Boolean useEnvironment) {
    }

    public record CheckDto(boolean ok, String detail) {
    }
}
