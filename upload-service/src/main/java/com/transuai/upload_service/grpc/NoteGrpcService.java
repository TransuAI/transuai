package com.transuai.upload_service.grpc;

import java.util.Comparator;
import java.util.Set;
import java.util.UUID;

import com.google.protobuf.Empty;
import com.transuai.upload.grpc.v1.CreateNoteRequest;
import com.transuai.upload.grpc.v1.DeleteNoteRequest;
import com.transuai.upload.grpc.v1.ListNotesRequest;
import com.transuai.upload.grpc.v1.ListNotesResponse;
import com.transuai.upload.grpc.v1.Note;
import com.transuai.upload.grpc.v1.NoteServiceGrpc;
import com.transuai.upload.grpc.v1.UpdateNoteRequest;
import com.transuai.upload_service.domain.JobEntity;
import com.transuai.upload_service.domain.JobNoteEntity;
import com.transuai.upload_service.grpc.auth.GrpcAuthContext;
import com.transuai.upload_service.repository.JobNoteRepository;
import com.transuai.upload_service.repository.JobRepository;

import io.grpc.Status;
import io.grpc.stub.StreamObserver;
import lombok.RequiredArgsConstructor;
import org.springframework.grpc.server.service.GrpcService;

// 筆記（見 CONTEXT.md「筆記」）：一律先確認 Job 是這位使用者的，筆記是這個 Job 的；對不上都是 NOT_FOUND（不透露存在與否）。
@GrpcService
@RequiredArgsConstructor
public class NoteGrpcService extends NoteServiceGrpc.NoteServiceImplBase {

    static final int MAX_TEXT_LENGTH = 2000;
    static final int MAX_NOTES_PER_JOB = 500;
    private static final Set<String> SOURCES = Set.of("manual", "qa");

    // 依時間排序，沒有時間的在最後；同一個時間依建立順序。
    private static final Comparator<JobNoteEntity> BY_TIME = Comparator
            .comparing(JobNoteEntity::getTimeSeconds, Comparator.nullsLast(Comparator.naturalOrder()))
            .thenComparing(JobNoteEntity::getCreatedAt);

    private final JobRepository jobRepository;
    private final JobNoteRepository noteRepository;

    @Override
    public void listNotes(ListNotesRequest request, StreamObserver<ListNotesResponse> responseObserver) {
        JobEntity job = ownJob(request.getJobId());
        responseObserver.onNext(ListNotesResponse.newBuilder()
                .addAllNotes(noteRepository.findByJobId(job.getId()).stream().sorted(BY_TIME).map(NoteGrpcService::toProto).toList())
                .build());
        responseObserver.onCompleted();
    }

    @Override
    public void createNote(CreateNoteRequest request, StreamObserver<Note> responseObserver) {
        JobEntity job = ownJob(request.getJobId());
        String text = checkedText(request.getText());
        Double time = request.hasTimeSeconds() ? request.getTimeSeconds() : null;
        if (time == null && text.isEmpty()) {
            throw invalid("a note needs a time or some text");
        }
        if (time != null && (time < 0 || (job.getDurationSeconds() != null && time > job.getDurationSeconds()))) {
            throw invalid("time_seconds must be within the recording");
        }
        String source = request.getSource().isBlank() ? "manual" : request.getSource();
        if (!SOURCES.contains(source)) {
            throw invalid("source must be manual or qa");
        }
        if (noteRepository.countByJobId(job.getId()) >= MAX_NOTES_PER_JOB) {
            throw invalid("a job holds at most " + MAX_NOTES_PER_JOB + " notes");
        }
        JobNoteEntity note = noteRepository.save(JobNoteEntity.builder()
                .jobId(job.getId()).userId(job.getUserId()).timeSeconds(time).text(text).source(source).build());
        responseObserver.onNext(toProto(note));
        responseObserver.onCompleted();
    }

    @Override
    public void updateNote(UpdateNoteRequest request, StreamObserver<Note> responseObserver) {
        JobNoteEntity note = ownNote(request.getJobId(), request.getNoteId());
        String text = checkedText(request.getText());
        if (text.isEmpty() && note.getTimeSeconds() == null) {
            throw invalid("a note without a time needs some text");
        }
        note.setText(text);
        responseObserver.onNext(toProto(noteRepository.save(note)));
        responseObserver.onCompleted();
    }

    @Override
    public void deleteNote(DeleteNoteRequest request, StreamObserver<Empty> responseObserver) {
        noteRepository.delete(ownNote(request.getJobId(), request.getNoteId()));
        responseObserver.onNext(Empty.getDefaultInstance());
        responseObserver.onCompleted();
    }

    private JobEntity ownJob(String rawJobId) {
        return jobRepository.findByIdAndUserId(uuid(rawJobId, "job_id"), GrpcAuthContext.currentUserId())
                .orElseThrow(() -> Status.NOT_FOUND.withDescription("job not found").asRuntimeException());
    }

    private JobNoteEntity ownNote(String rawJobId, String rawNoteId) {
        JobEntity job = ownJob(rawJobId);
        return noteRepository.findByIdAndJobId(uuid(rawNoteId, "note_id"), job.getId())
                .orElseThrow(() -> Status.NOT_FOUND.withDescription("note not found").asRuntimeException());
    }

    private static String checkedText(String text) {
        String stripped = text.strip();
        if (stripped.length() > MAX_TEXT_LENGTH) {
            throw invalid("text is longer than " + MAX_TEXT_LENGTH + " characters");
        }
        return stripped;
    }

    private static UUID uuid(String raw, String field) {
        try {
            return UUID.fromString(raw);
        } catch (IllegalArgumentException e) {
            throw invalid(field + " must be a valid UUID");
        }
    }

    private static RuntimeException invalid(String description) {
        return Status.INVALID_ARGUMENT.withDescription(description).asRuntimeException();
    }

    private static Note toProto(JobNoteEntity note) {
        Note.Builder builder = Note.newBuilder()
                .setNoteId(note.getId().toString())
                .setJobId(note.getJobId().toString())
                .setText(note.getText())
                .setSource(note.getSource())
                .setCreatedAt(GrpcTimestamps.toProto(note.getCreatedAt()))
                .setUpdatedAt(GrpcTimestamps.toProto(note.getUpdatedAt()));
        if (note.getTimeSeconds() != null) {
            builder.setTimeSeconds(note.getTimeSeconds());
        }
        return builder.build();
    }
}
