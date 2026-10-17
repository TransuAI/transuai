package com.transuai.gateway.web.dto;

import transuai.ai.v1.Ai.SpeakerSuggestion;

// 講者名字建議：依據是錄音裡某一句明確講出身分的話（evidenceStartTime 秒、evidenceText 原文）。status 是 pending / applied / dismissed。
public record SpeakerSuggestionDto(String speakerLabel, String name, double evidenceStartTime, String evidenceText,
        String status) {

    public static SpeakerSuggestionDto from(SpeakerSuggestion suggestion) {
        return new SpeakerSuggestionDto(suggestion.getSpeakerLabel(), suggestion.getName(),
                suggestion.getEvidenceStartTime(), suggestion.getEvidenceText(), suggestion.getStatus());
    }
}
