package com.transuai.gateway.web.dto;

// speakerLabel 對應 TranscriptDto.speakers 的 label，沒有講者資訊時是 null；text 是空字串代表已清空片段；
// originalText 是人工編輯前的機器產出，供還原使用。
public record SegmentDto(String id, double startTime, double endTime, String speakerLabel, String text,
        String originalText) {
}
