package com.transuai.gateway.web.dto;

// text 是空字串代表已清空片段；originalText 是人工編輯前的機器產出，供還原使用。
public record SegmentDto(String id, double startTime, double endTime, String speakerLabel, String text,
        String originalText) {
}
