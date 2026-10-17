package com.transuai.gateway.web.dto;

import java.time.Instant;

import com.transuai.gateway.grpc.GrpcTimestamps;
import com.transuai.upload.grpc.v1.Note;

// 筆記：timeSeconds 是釘在錄音的哪個時間（沒釘是 null；只有時間、沒有文字的是書籤）；source 是 manual 或 qa（從問答存的）。
public record NoteDto(String noteId, String jobId, Double timeSeconds, String text, String source, Instant createdAt,
        Instant updatedAt) {

    public static NoteDto from(Note note) {
        return new NoteDto(note.getNoteId(), note.getJobId(), note.hasTimeSeconds() ? note.getTimeSeconds() : null,
                note.getText(), note.getSource(), GrpcTimestamps.toInstant(note.getCreatedAt()),
                GrpcTimestamps.toInstant(note.getUpdatedAt()));
    }
}
