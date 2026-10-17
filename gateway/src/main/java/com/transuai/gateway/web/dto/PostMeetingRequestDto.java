package com.transuai.gateway.web.dto;

import jakarta.validation.constraints.Size;

// 瀏覽器的 IANA 時區（例如 Asia/Taipei），換算相對日期用。
public record PostMeetingRequestDto(@Size(max = 64) String timezone) {
}
