package com.transuai.gateway.web.dto;

import java.util.List;

// 改片段講者後的結果：更新後的片段、這個 Job 所有的講者（可能多了新增的那位），以及逐字稿目前的 revision。
public record SegmentSpeakerUpdateDto(SegmentDto segment, List<SpeakerDto> speakers, int revision) {
}
