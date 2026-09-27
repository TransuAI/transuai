package com.transuai.gateway.web.dto;

// 整份換掉；網址是 null 或空字串是不指定。todoDestination 是 GOOGLE_TASKS / NOTION，null 是維持原本的。
public record UpdatePostMeetingSettingsDto(String notionMeetingsPageUrl, String notionTodoDatabaseUrl,
        String todoDestination) {
}
