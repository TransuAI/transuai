package com.transuai.upload_service.grpc;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.stream.IntStream;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.grpc.test.autoconfigure.AutoConfigureTestGrpcTransport;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.grpc.client.GrpcChannelFactory;

import com.transuai.upload.grpc.v1.CompleteUploadRequest;
import com.transuai.upload.grpc.v1.CreateNoteRequest;
import com.transuai.upload.grpc.v1.DeleteJobRequest;
import com.transuai.upload.grpc.v1.DeleteNoteRequest;
import com.transuai.upload.grpc.v1.FileType;
import com.transuai.upload.grpc.v1.GetPresignedUploadUrlRequest;
import com.transuai.upload.grpc.v1.GetPresignedUploadUrlResponse;
import com.transuai.upload.grpc.v1.Job;
import com.transuai.upload.grpc.v1.ListNotesRequest;
import com.transuai.upload.grpc.v1.Note;
import com.transuai.upload.grpc.v1.NoteServiceGrpc;
import com.transuai.upload.grpc.v1.UpdateNoteRequest;
import com.transuai.upload.grpc.v1.UploadServiceGrpc;
import com.transuai.upload_service.domain.JobNoteEntity;
import com.transuai.upload_service.repository.JobNoteRepository;
import com.transuai.upload_service.repository.JobRepository;

import io.grpc.CallOptions;
import io.grpc.Channel;
import io.grpc.ClientCall;
import io.grpc.ClientInterceptor;
import io.grpc.ForwardingClientCall.SimpleForwardingClientCall;
import io.grpc.Metadata;
import io.grpc.MethodDescriptor;
import io.grpc.Status;
import io.grpc.StatusRuntimeException;

/**
 * 筆記（見 .scratch/job-notes）。需要本機 infra（postgres / rabbitmq / minio，見 infra/docker-compose.yaml）先啟動。
 */
@SpringBootTest
@AutoConfigureTestGrpcTransport
class NoteGrpcServiceIT {

    @Autowired
    private GrpcChannelFactory channelFactory;

    @Autowired
    private JobRepository jobRepository;

    @Autowired
    private JobNoteRepository noteRepository;

    private final List<UUID> createdJobIds = new ArrayList<>();
    private final UUID user = UUID.randomUUID();

    @SuppressWarnings("unused")
    @AfterEach
    void cleanUp() {
        createdJobIds.forEach(id -> {
            noteRepository.deleteAll(noteRepository.findByJobId(id));
            jobRepository.deleteById(id);
        });
        createdJobIds.clear();
    }

    @Test
    void notesAreAddedListedByTimeEditedAndDeleted() throws Exception {
        String job = createJob(user, 300).getJobId();
        Note idea = notes(user).createNote(CreateNoteRequest.newBuilder().setJobId(job).setTimeSeconds(30).setText("預算要再確認").build());
        notes(user).createNote(CreateNoteRequest.newBuilder().setJobId(job).setText("整體心得：會議太長").build());
        notes(user).createNote(CreateNoteRequest.newBuilder().setJobId(job).setTimeSeconds(10).build()); // a bookmark

        assertThat(list(user, job)).extracting(n -> n.hasTimeSeconds() ? n.getTimeSeconds() : null, Note::getText)
                .containsExactly(
                        org.assertj.core.groups.Tuple.tuple(10.0, ""),
                        org.assertj.core.groups.Tuple.tuple(30.0, "預算要再確認"),
                        org.assertj.core.groups.Tuple.tuple(null, "整體心得：會議太長"));
        assertThat(idea.getSource()).isEqualTo("manual");

        Note edited = notes(user).updateNote(UpdateNoteRequest.newBuilder().setJobId(job).setNoteId(idea.getNoteId())
                .setText("預算要再確認，週五前").build());
        assertThat(edited.getText()).isEqualTo("預算要再確認，週五前");
        assertThat(edited.getTimeSeconds()).isEqualTo(30.0);

        notes(user).deleteNote(DeleteNoteRequest.newBuilder().setJobId(job).setNoteId(idea.getNoteId()).build());
        assertThat(list(user, job)).extracting(Note::getText).doesNotContain("預算要再確認，週五前");
    }

    @Test
    void aNoteSavedFromQuestionsAndAnswersKeepsItsSource() throws Exception {
        String job = createJob(user, 300).getJobId();

        Note saved = notes(user).createNote(CreateNoteRequest.newBuilder().setJobId(job).setText("回答").setSource("qa").build());

        assertThat(saved.getSource()).isEqualTo("qa");
    }

    @Test
    void aNoteThatIsNotANoteIsRefused() throws Exception {
        String job = createJob(user, 300).getJobId();

        for (CreateNoteRequest bad : List.of(
                CreateNoteRequest.newBuilder().setJobId(job).build(),  // neither a time nor any text
                CreateNoteRequest.newBuilder().setJobId(job).setText("   ").build(),
                CreateNoteRequest.newBuilder().setJobId(job).setText("字".repeat(2001)).build(),
                CreateNoteRequest.newBuilder().setJobId(job).setTimeSeconds(-1).build(),
                CreateNoteRequest.newBuilder().setJobId(job).setTimeSeconds(301).build(),  // after the recording ends
                CreateNoteRequest.newBuilder().setJobId(job).setText("t").setSource("magic").build())) {
            assertThatThrownBy(() -> notes(user).createNote(bad)).isInstanceOfSatisfying(StatusRuntimeException.class,
                    e -> assertThat(e.getStatus().getCode()).isEqualTo(Status.Code.INVALID_ARGUMENT));
        }
    }

    @Test
    void onlyANoteWithATimeCanLoseItsText() throws Exception {
        String job = createJob(user, 300).getJobId();
        Note untimed = notes(user).createNote(CreateNoteRequest.newBuilder().setJobId(job).setText("心得").build());
        Note timed = notes(user).createNote(CreateNoteRequest.newBuilder().setJobId(job).setTimeSeconds(5).setText("這裡").build());

        assertThat(notes(user).updateNote(UpdateNoteRequest.newBuilder().setJobId(job).setNoteId(timed.getNoteId()).build())
                .getText()).isEmpty();
        assertThatThrownBy(() -> notes(user).updateNote(
                UpdateNoteRequest.newBuilder().setJobId(job).setNoteId(untimed.getNoteId()).build()))
                .isInstanceOfSatisfying(StatusRuntimeException.class,
                        e -> assertThat(e.getStatus().getCode()).isEqualTo(Status.Code.INVALID_ARGUMENT));
    }

    @Test
    void aJobHoldsAtMost500Notes() throws Exception {
        String job = createJob(user, 300).getJobId();
        UUID jobId = UUID.fromString(job);
        noteRepository.saveAll(IntStream.range(0, 500)
                .mapToObj(i -> JobNoteEntity.builder().jobId(jobId).userId(user).text("第 " + i + " 則").source("manual").build())
                .toList());

        assertThatThrownBy(() -> notes(user).createNote(CreateNoteRequest.newBuilder().setJobId(job).setText("再一則").build()))
                .isInstanceOfSatisfying(StatusRuntimeException.class,
                        e -> assertThat(e.getStatus().getCode()).isEqualTo(Status.Code.INVALID_ARGUMENT));
    }

    @Test
    void someoneElsesJobAndAnotherJobsNotesAreNotFound() throws Exception {
        String mine = createJob(user, 300).getJobId();
        String other = createJob(user, 300).getJobId();
        Note onOther = notes(user).createNote(CreateNoteRequest.newBuilder().setJobId(other).setText("別的 Job").build());
        UUID stranger = UUID.randomUUID();

        assertNotFound(() -> notes(stranger).listNotes(ListNotesRequest.newBuilder().setJobId(mine).build()));
        assertNotFound(() -> notes(stranger).createNote(CreateNoteRequest.newBuilder().setJobId(mine).setText("t").build()));
        assertNotFound(() -> notes(user).updateNote(UpdateNoteRequest.newBuilder().setJobId(mine)
                .setNoteId(onOther.getNoteId()).setText("改").build()));
        assertNotFound(() -> notes(user).deleteNote(DeleteNoteRequest.newBuilder().setJobId(mine)
                .setNoteId(onOther.getNoteId()).build()));
    }

    @Test
    void deletingAJobDeletesItsNotes() throws Exception {
        String job = createJob(user, 300).getJobId();
        notes(user).createNote(CreateNoteRequest.newBuilder().setJobId(job).setText("會跟著刪掉").build());

        uploads(user).deleteJob(DeleteJobRequest.newBuilder().setJobId(job).build());

        assertThat(noteRepository.findByJobId(UUID.fromString(job))).isEmpty();
    }

    private static void assertNotFound(Runnable call) {
        assertThatThrownBy(call::run).isInstanceOfSatisfying(StatusRuntimeException.class,
                e -> assertThat(e.getStatus().getCode()).isEqualTo(Status.Code.NOT_FOUND));
    }

    private List<Note> list(UUID userId, String jobId) {
        return notes(userId).listNotes(ListNotesRequest.newBuilder().setJobId(jobId).build()).getNotesList();
    }

    private NoteServiceGrpc.NoteServiceBlockingStub notes(UUID userId) {
        return NoteServiceGrpc.newBlockingStub(channelFactory.createChannel("upload-service"))
                .withInterceptors(new UserIdHeaderInterceptor(userId.toString()));
    }

    private UploadServiceGrpc.UploadServiceBlockingStub uploads(UUID userId) {
        return UploadServiceGrpc.newBlockingStub(channelFactory.createChannel("upload-service"))
                .withInterceptors(new UserIdHeaderInterceptor(userId.toString()));
    }

    private Job createJob(UUID userId, int durationSeconds) throws Exception {
        UploadServiceGrpc.UploadServiceBlockingStub stub = uploads(userId);
        GetPresignedUploadUrlResponse presigned = stub.getPresignedUploadUrl(GetPresignedUploadUrlRequest.newBuilder()
                .setFileName("meeting.mp3").setFileType(FileType.AUDIO).setContentType("audio/mpeg").setFileSizeBytes(1024L).build());
        HttpResponse<String> put = HttpClient.newHttpClient().send(
                HttpRequest.newBuilder(URI.create(presigned.getUploadUrl())).header("Content-Type", "audio/mpeg").PUT(HttpRequest.BodyPublishers.ofString("bytes")).build(),
                HttpResponse.BodyHandlers.ofString());
        assertThat(put.statusCode()).isEqualTo(200);
        Job job = stub.completeUpload(CompleteUploadRequest.newBuilder().setStoragePath(presigned.getStoragePath())
                .setFileName("meeting.mp3").setFileType(FileType.AUDIO).setFileSizeBytes(1024L)
                .setDurationSeconds(durationSeconds).build());
        createdJobIds.add(UUID.fromString(job.getJobId()));
        return job;
    }

    private record UserIdHeaderInterceptor(String userId) implements ClientInterceptor {
        private static final Metadata.Key<String> USER_ID_HEADER = Metadata.Key.of("x-user-id", Metadata.ASCII_STRING_MARSHALLER);

        @Override
        public <ReqT, RespT> ClientCall<ReqT, RespT> interceptCall(MethodDescriptor<ReqT, RespT> method,
                CallOptions callOptions, Channel next) {
            return new SimpleForwardingClientCall<>(next.newCall(method, callOptions)) {
                @Override
                public void start(Listener<RespT> responseListener, Metadata headers) {
                    headers.put(USER_ID_HEADER, userId);
                    super.start(responseListener, headers);
                }
            };
        }
    }
}
