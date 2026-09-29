package com.transuai.gateway.web.dto;

// timeSeconds、text、source 都可以省略（但時間與文字不能都沒有，upload-service 會回 400）；source 預設 manual。
public record CreateNoteRequestDto(Double timeSeconds, String text, String source) {
}
