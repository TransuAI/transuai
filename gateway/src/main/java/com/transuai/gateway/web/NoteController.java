package com.transuai.gateway.web;

import java.util.List;
import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import com.transuai.gateway.grpc.GrpcMetadataSupport;
import com.transuai.gateway.grpc.GrpcStrings;
import com.transuai.gateway.web.dto.CreateNoteRequestDto;
import com.transuai.gateway.web.dto.NoteDto;
import com.transuai.gateway.web.dto.UpdateNoteRequestDto;
import com.transuai.upload.grpc.v1.CreateNoteRequest;
import com.transuai.upload.grpc.v1.DeleteNoteRequest;
import com.transuai.upload.grpc.v1.ListNotesRequest;
import com.transuai.upload.grpc.v1.NoteServiceGrpc;
import com.transuai.upload.grpc.v1.UpdateNoteRequest;

import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;

// 筆記（見 upload-service CONTEXT.md）：upload-service 依 x-user-id 檢查 Job 是登入者的（跟 GET /jobs/{jobId} 一樣），
// 不是的回 404；筆記不像樣（沒有時間也沒有文字、太長、時間超出錄音、超過 500 則）回 400。
@RestController
@RequiredArgsConstructor
public class NoteController {

    private final NoteServiceGrpc.NoteServiceBlockingStub noteServiceStub;

    @GetMapping("/jobs/{jobId}/notes")
    public List<NoteDto> listNotes(@CurrentUserId UUID userId, @PathVariable String jobId) {
        return notes(userId).listNotes(ListNotesRequest.newBuilder().setJobId(jobId).build())
                .getNotesList().stream().map(NoteDto::from).toList();
    }

    @PostMapping("/jobs/{jobId}/notes")
    public NoteDto createNote(@CurrentUserId UUID userId, @PathVariable String jobId,
            @Valid @RequestBody CreateNoteRequestDto request) {
        CreateNoteRequest.Builder note = CreateNoteRequest.newBuilder().setJobId(jobId)
                .setText(GrpcStrings.nullToEmpty(request.text())).setSource(GrpcStrings.nullToEmpty(request.source()));
        if (request.timeSeconds() != null) {
            note.setTimeSeconds(request.timeSeconds());
        }
        return NoteDto.from(notes(userId).createNote(note.build()));
    }

    @PatchMapping("/jobs/{jobId}/notes/{noteId}")
    public NoteDto updateNote(@CurrentUserId UUID userId, @PathVariable String jobId, @PathVariable String noteId,
            @Valid @RequestBody UpdateNoteRequestDto request) {
        return NoteDto.from(notes(userId).updateNote(UpdateNoteRequest.newBuilder().setJobId(jobId).setNoteId(noteId)
                .setText(GrpcStrings.nullToEmpty(request.text())).build()));
    }

    @DeleteMapping("/jobs/{jobId}/notes/{noteId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteNote(@CurrentUserId UUID userId, @PathVariable String jobId, @PathVariable String noteId) {
        notes(userId).deleteNote(DeleteNoteRequest.newBuilder().setJobId(jobId).setNoteId(noteId).build());
    }

    private NoteServiceGrpc.NoteServiceBlockingStub notes(UUID userId) {
        return GrpcMetadataSupport.withUserId(noteServiceStub, userId);
    }
}
