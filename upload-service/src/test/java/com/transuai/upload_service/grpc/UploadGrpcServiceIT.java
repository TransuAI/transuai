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
import org.springframework.amqp.core.Message;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.grpc.test.autoconfigure.AutoConfigureTestGrpcTransport;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.grpc.client.GrpcChannelFactory;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.transuai.upload.grpc.v1.CompleteUploadRequest;
import com.transuai.upload.grpc.v1.DeleteJobRequest;
import com.transuai.upload.grpc.v1.FileType;
import com.transuai.upload.grpc.v1.GetJobRequest;
import com.transuai.upload.grpc.v1.GetPresignedUploadUrlRequest;
import com.transuai.upload.grpc.v1.GetPresignedUploadUrlResponse;
import com.transuai.upload.grpc.v1.Job;
import com.transuai.upload.grpc.v1.JobStatus;
import com.transuai.upload.grpc.v1.ListJobsRequest;
import com.transuai.upload.grpc.v1.ListJobsResponse;
import com.transuai.upload.grpc.v1.UploadServiceGrpc;
import com.transuai.upload_service.config.MqProperties;
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
import com.google.protobuf.Empty;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 需要本機 infra（postgres / rabbitmq / minio，見 infra/docker-compose.yaml）先啟動。
 * gRPC transport 本身用 in-process test transport，不需要另外跑 bootRun / 佔用 9090 port。
 */
@SpringBootTest
@AutoConfigureTestGrpcTransport
class UploadGrpcServiceIT {

    @Autowired
    private GrpcChannelFactory channelFactory;

    @Autowired
    private JobRepository jobRepository;

    @Autowired
    private RabbitTemplate rabbitTemplate;

    @Autowired
    private MqProperties mqProperties;

    private final ObjectMapper objectMapper = new ObjectMapper();
    private final List<UUID> createdJobIds = new ArrayList<>();

    // JUnit 5 透過反射在每個 @Test 執行後呼叫，不會有直接的呼叫端，IDE 的「unused」偵測看不到這點。
    @SuppressWarnings("unused")
    @AfterEach
    void cleanUp() {
        createdJobIds.forEach(jobRepository::deleteById);
        createdJobIds.clear();
        while (rabbitTemplate.receive(mqProperties.transcriptionRequestedQueue(), 100) != null) {
            // drain leftover test messages so queue depth doesn't leak between tests
        }
    }

    @Test
    void callWithoutUserIdHeader_isRejected() {
        UploadServiceGrpc.UploadServiceBlockingStub stub = UploadServiceGrpc.newBlockingStub(
                channelFactory.createChannel("upload-service"));

        assertThatThrownBy(() -> stub.getJob(GetJobRequest.newBuilder().setJobId(UUID.randomUUID().toString()).build()))
                .isInstanceOfSatisfying(StatusRuntimeException.class,
                        e -> assertThat(e.getStatus().getCode()).isEqualTo(Status.Code.UNAUTHENTICATED));
    }

    @Test
    void getPresignedUploadUrl_thenCompleteUpload_createsUploadedJobAndPublishesEvent() throws Exception {
        UploadServiceGrpc.UploadServiceBlockingStub stub = stubFor(UUID.randomUUID());

        GetPresignedUploadUrlResponse presigned = stub.getPresignedUploadUrl(GetPresignedUploadUrlRequest.newBuilder()
                .setFileName("standup.mp3")
                .setFileType(FileType.AUDIO)
                .setFileSizeBytes(2048L)
                .build());
        assertThat(presigned.getUploadUrl()).contains("/media-uploads/");
        assertThat(presigned.getStoragePath()).startsWith("uploads/").endsWith("-standup.mp3");

        putBytes(presigned.getUploadUrl());

        Job job = stub.completeUpload(CompleteUploadRequest.newBuilder()
                .setStoragePath(presigned.getStoragePath())
                .setFileName("standup.mp3")
                .setFileType(FileType.AUDIO)
                .setFileSizeBytes(2048L)
                .build());
        createdJobIds.add(UUID.fromString(job.getJobId()));

        assertThat(job.getStatus()).isEqualTo(JobStatus.UPLOADED);
        assertThat(job.getStoragePath()).isEqualTo(presigned.getStoragePath());

        Message message = rabbitTemplate.receive(mqProperties.transcriptionRequestedQueue(), 2000);
        assertThat(message).as("transcription.requested event should have been published").isNotNull();
        var payload = objectMapper.readTree(message.getBody());
        assertThat(payload.get("jobId").asText()).isEqualTo(job.getJobId());
        assertThat(payload.get("storagePath").asText()).isEqualTo(job.getStoragePath());
        assertThat(payload.get("fileType").asText()).isEqualTo("AUDIO");
    }

    @Test
    void completeUpload_rejectsStoragePathBelongingToAnotherUser() throws Exception {
        UUID userId = UUID.randomUUID();
        UploadServiceGrpc.UploadServiceBlockingStub stub = stubFor(userId);

        String foreignStoragePath = "uploads/" + UUID.randomUUID() + "/somebody-elses-file.mp3";

        assertThatThrownBy(() -> stub.completeUpload(CompleteUploadRequest.newBuilder()
                .setStoragePath(foreignStoragePath)
                .setFileName("file.mp3")
                .setFileType(FileType.AUDIO)
                .setFileSizeBytes(10L)
                .build()))
                .isInstanceOfSatisfying(StatusRuntimeException.class,
                        e -> assertThat(e.getStatus().getCode()).isEqualTo(Status.Code.PERMISSION_DENIED));
    }

    @Test
    void getJob_returnsNotFound_whenJobBelongsToAnotherUser() throws Exception {
        Job job = createJob(UUID.randomUUID(), "owner-only.mp3");
        UploadServiceGrpc.UploadServiceBlockingStub otherUserStub = stubFor(UUID.randomUUID());

        assertThatThrownBy(() -> otherUserStub.getJob(GetJobRequest.newBuilder().setJobId(job.getJobId()).build()))
                .isInstanceOfSatisfying(StatusRuntimeException.class,
                        e -> assertThat(e.getStatus().getCode()).isEqualTo(Status.Code.NOT_FOUND));
    }

    // Job（protobuf 產生的類別）沒有標注 null annotation，Eclipse null analysis 對 AssertJ
    // 的 @Nonnull ThrowingExtractor 過度保守，這裡的方法參考在執行期完全安全。
    @SuppressWarnings("null")
    @Test
    void listJobs_returnsOnlyCallersJobsWithPagination() throws Exception {
        UUID userId = UUID.randomUUID();
        Job jobA = createJob(userId, "a.mp3");
        Job jobB = createJob(userId, "b.mp3");
        createJob(UUID.randomUUID(), "someone-elses.mp3");

        UploadServiceGrpc.UploadServiceBlockingStub stub = stubFor(userId);
        ListJobsResponse response = stub.listJobs(ListJobsRequest.newBuilder().setPage(1).setPageSize(10).build());

        assertThat(response.getTotalCount()).isEqualTo(2);
        assertThat(response.getJobsList()).extracting(Job::getJobId)
                .containsExactlyInAnyOrder(jobA.getJobId(), jobB.getJobId());
    }

    @Test
    void deleteJob_removesJobAndStorageObject() throws Exception {
        UUID userId = UUID.randomUUID();
        Job job = createJob(userId, "delete-me.mp3");
        UploadServiceGrpc.UploadServiceBlockingStub stub = stubFor(userId);

        Empty ignored = stub.deleteJob(DeleteJobRequest.newBuilder().setJobId(job.getJobId()).build());
        assertThat(ignored).isNotNull();
        createdJobIds.remove(UUID.fromString(job.getJobId()));

        assertThatThrownBy(() -> stub.getJob(GetJobRequest.newBuilder().setJobId(job.getJobId()).build()))
                .isInstanceOfSatisfying(StatusRuntimeException.class,
                        e -> assertThat(e.getStatus().getCode()).isEqualTo(Status.Code.NOT_FOUND));
        assertThat(jobRepository.findById(UUID.fromString(job.getJobId()))).isEmpty();
    }

    private Job createJob(UUID userId, String fileName) throws Exception {
        UploadServiceGrpc.UploadServiceBlockingStub stub = stubFor(userId);
        GetPresignedUploadUrlResponse presigned = stub.getPresignedUploadUrl(GetPresignedUploadUrlRequest.newBuilder()
                .setFileName(fileName)
                .setFileType(FileType.AUDIO)
                .setFileSizeBytes(1024L)
                .build());
        putBytes(presigned.getUploadUrl());

        Job job = stub.completeUpload(CompleteUploadRequest.newBuilder()
                .setStoragePath(presigned.getStoragePath())
                .setFileName(fileName)
                .setFileType(FileType.AUDIO)
                .setFileSizeBytes(1024L)
                .build());
        createdJobIds.add(UUID.fromString(job.getJobId()));
        return job;
    }

    private UploadServiceGrpc.UploadServiceBlockingStub stubFor(UUID userId) {
        Channel channel = channelFactory.createChannel("upload-service");
        return UploadServiceGrpc.newBlockingStub(channel)
                .withInterceptors(new UserIdHeaderInterceptor(userId.toString()));
    }

    private static void putBytes(String uploadUrl) throws Exception {
        HttpResponse<String> response = HttpClient.newHttpClient().send(
                HttpRequest.newBuilder(URI.create(uploadUrl)).PUT(HttpRequest.BodyPublishers.ofString("bytes")).build(),
                HttpResponse.BodyHandlers.ofString());
        assertThat(response.statusCode()).isEqualTo(200);
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
