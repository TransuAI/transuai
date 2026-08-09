package com.transuai.upload_service.grpc;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.grpc.test.autoconfigure.AutoConfigureTestGrpcTransport;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.grpc.client.GrpcChannelFactory;

import com.transuai.upload.grpc.v1.CompleteUploadRequest;
import com.transuai.upload.grpc.v1.FileType;
import com.transuai.upload.grpc.v1.GetPresignedUploadUrlRequest;
import com.transuai.upload.grpc.v1.GetPresignedUploadUrlResponse;
import com.transuai.upload.grpc.v1.InternalJobServiceGrpc;
import com.transuai.upload.grpc.v1.Job;
import com.transuai.upload.grpc.v1.JobStatus;
import com.transuai.upload.grpc.v1.UpdateJobStatusRequest;
import com.transuai.upload.grpc.v1.UploadServiceGrpc;
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

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 需要本機 infra（postgres / rabbitmq / minio，見 infra/docker-compose.yaml）先啟動。
 * InternalJobService 不需要 x-user-id，這裡的 stub 都刻意不帶該 header，驗證它真的對 pipeline 下游開放。
 */
@SpringBootTest
@AutoConfigureTestGrpcTransport
class InternalJobGrpcServiceIT {

    @Autowired
    private GrpcChannelFactory channelFactory;

    @Autowired
    private JobRepository jobRepository;

    private final List<UUID> createdJobIds = new ArrayList<>();

    // JUnit 5 透過反射在每個 @Test 執行後呼叫，不會有直接的呼叫端，IDE 的「unused」偵測看不到這點。
    @SuppressWarnings("unused")
    @AfterEach
    void cleanUp() {
        createdJobIds.forEach(jobRepository::deleteById);
        createdJobIds.clear();
    }

    @Test
    void updateJobStatus_updatesStatusWithoutUserIdHeader() throws Exception {
        Job job = createJob(UUID.randomUUID(), "call.mp3");

        Job updated = internalStub().updateJobStatus(UpdateJobStatusRequest.newBuilder()
                .setJobId(job.getJobId())
                .setStatus(JobStatus.TRANSCRIBING)
                .build());

        assertThat(updated.getStatus()).isEqualTo(JobStatus.TRANSCRIBING);
        assertThat(jobRepository.findById(UUID.fromString(job.getJobId())).orElseThrow().getStatus().name())
                .isEqualTo("TRANSCRIBING");
    }

    @Test
    void updateJobStatus_setsErrorReasonOnFailed() throws Exception {
        Job job = createJob(UUID.randomUUID(), "call.mp3");

        Job updated = internalStub().updateJobStatus(UpdateJobStatusRequest.newBuilder()
                .setJobId(job.getJobId())
                .setStatus(JobStatus.FAILED)
                .setErrorReason("groq api timeout")
                .build());

        assertThat(updated.getStatus()).isEqualTo(JobStatus.FAILED);
        assertThat(updated.getErrorReason()).isEqualTo("groq api timeout");
    }

    @Test
    void updateJobStatus_returnsNotFound_forUnknownJobId() {
        assertThatThrownBy(() -> internalStub().updateJobStatus(UpdateJobStatusRequest.newBuilder()
                .setJobId(UUID.randomUUID().toString())
                .setStatus(JobStatus.TRANSCRIBED)
                .build()))
                .isInstanceOfSatisfying(StatusRuntimeException.class,
                        e -> assertThat(e.getStatus().getCode()).isEqualTo(Status.Code.NOT_FOUND));
    }

    @Test
    void updateJobStatus_returnsInvalidArgument_forMalformedJobId() {
        assertThatThrownBy(() -> internalStub().updateJobStatus(UpdateJobStatusRequest.newBuilder()
                .setJobId("not-a-uuid")
                .setStatus(JobStatus.TRANSCRIBED)
                .build()))
                .isInstanceOfSatisfying(StatusRuntimeException.class,
                        e -> assertThat(e.getStatus().getCode()).isEqualTo(Status.Code.INVALID_ARGUMENT));
    }

    private Job createJob(UUID userId, String fileName) throws Exception {
        UploadServiceGrpc.UploadServiceBlockingStub stub = UploadServiceGrpc
                .newBlockingStub(channelFactory.createChannel("upload-service"))
                .withInterceptors(new UserIdHeaderInterceptor(userId.toString()));

        GetPresignedUploadUrlResponse presigned = stub.getPresignedUploadUrl(GetPresignedUploadUrlRequest.newBuilder()
                .setFileName(fileName)
                .setFileType(FileType.AUDIO)
                .setFileSizeBytes(1024L)
                .build());
        HttpResponse<String> putResponse = HttpClient.newHttpClient().send(
                HttpRequest.newBuilder(URI.create(presigned.getUploadUrl()))
                        .PUT(HttpRequest.BodyPublishers.ofString("bytes"))
                        .build(),
                HttpResponse.BodyHandlers.ofString());
        assertThat(putResponse.statusCode()).isEqualTo(200);

        Job job = stub.completeUpload(CompleteUploadRequest.newBuilder()
                .setStoragePath(presigned.getStoragePath())
                .setFileName(fileName)
                .setFileType(FileType.AUDIO)
                .setFileSizeBytes(1024L)
                .build());
        createdJobIds.add(UUID.fromString(job.getJobId()));
        return job;
    }

    private InternalJobServiceGrpc.InternalJobServiceBlockingStub internalStub() {
        return InternalJobServiceGrpc.newBlockingStub(channelFactory.createChannel("upload-service"));
    }

    private record UserIdHeaderInterceptor(String userId) implements ClientInterceptor {
        private static final Metadata.Key<String> USER_ID_HEADER = Metadata.Key.of("x-user-id",
                Metadata.ASCII_STRING_MARSHALLER);

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
