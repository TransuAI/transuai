package com.transuai.gateway.web.dto;

import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

// 整份換掉；網址是 null 或空字串是不指定。todoDestination 是 GOOGLE_TASKS / NOTION，null 是維持原本的。
public record UpdatePostMeetingSettingsDto(@Size(max = 2000) String notionMeetingsPageUrl,
        @Pattern(regexp = "GOOGLE_TASKS|NOTION") String todoDestination) {
}
