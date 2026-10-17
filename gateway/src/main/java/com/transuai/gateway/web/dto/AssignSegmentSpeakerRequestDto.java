package com.transuai.gateway.web.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Size;

// 恰好給一個：speakerLabel＝改成這位現有的講者；newSpeaker＝新增一位講者給這個片段。
public record AssignSegmentSpeakerRequestDto(@Size(max = 20) String speakerLabel, @Valid NewSpeakerDto newSpeaker) {

    // name 空字串或省略＝預設名稱「講者 N」。
    public record NewSpeakerDto(@Size(max = 100) String name) {
    }
}
