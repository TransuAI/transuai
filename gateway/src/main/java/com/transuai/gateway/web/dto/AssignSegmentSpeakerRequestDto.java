package com.transuai.gateway.web.dto;

// 恰好給一個：speakerLabel＝改成這位現有的講者；newSpeaker＝新增一位講者給這個片段。
public record AssignSegmentSpeakerRequestDto(String speakerLabel, NewSpeakerDto newSpeaker) {

    // name 空字串或省略＝預設名稱「講者 N」。
    public record NewSpeakerDto(String name) {
    }
}
