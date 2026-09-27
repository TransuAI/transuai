package com.transuai.gateway.web.dto;

// 整份換掉；null 或空字串是不指定。
public record UpdatePostMeetingSettingsDto(String notionMeetingsPageUrl, String notionTodoDatabaseUrl) {
}
