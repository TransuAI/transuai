package com.transuai.gateway.web.dto;

// 替講者命名後的結果：更新後的講者，以及逐字稿目前的 revision。
public record SpeakerUpdateDto(SpeakerDto speaker, int revision) {
}
