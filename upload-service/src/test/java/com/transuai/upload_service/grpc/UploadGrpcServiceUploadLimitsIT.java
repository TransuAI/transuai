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

import com.transuai.upload.grpc.v1.CompleteUploadRequest;
import com.transuai.upload.grpc.v1.FileType;
import com.transuai.upload.grpc.v1.GetPresignedUploadUrlRequest;
import com.transuai.upload.grpc.v1.GetPresignedUploadUrlResponse;
import com.transuai.upload.grpc.v1.UploadServiceGrpc;
import com.transuai.upload_service.config.MqProperties;
import com.transuai.upload_service.repository.JobRepository;
import com.transuai.upload_service.service.StorageService;

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
 * 這個測試類獨立於 {@link UploadGrpcServiceIT}，用小到不切實際的 app.upload.* 上限（見
 * {@code @SpringBootTest(properties = ...)}）換來一個獨立的 Spring context，
 * 才能在測試裡真的觸發「超過上限」而不用真的傳輸幾百 MB/幾十 MB 的資料。
 * 見 docs/adr/0001-upload-size-limit-is-file-type-aware.md。
 */
@SpringBootTest(properties = {
        "app.upload.max-file-size-bytes=200",
        "app.upload.max-audio-file-size-bytes=100",
})
@AutoConfigureTestGrpcTransport
class UploadGrpcServiceUploadLimitsIT {

    @Autowired
    private GrpcChannelFactory channelFactory;

    @Autowired
    private JobRepository jobRepository;

    @Autowired
    private RabbitTemplate rabbitTemplate;

    @Autowired
    private MqProperties mqProperties;

    @Autowired
    private StorageService storageService;

    private final List<UUID> createdJobIds = new ArrayList<>();

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
    void getPresignedUploadUrl_rejectsFileSizeAboveGeneralLimit() {
        UploadServiceGrpc.UploadServiceBlockingStub stub = stubFor(UUID.randomUUID());

        assertThatThrownBy(() -> stub.getPresignedUploadUrl(GetPresignedUploadUrlRequest.newBuilder()
                .setFileName("huge.mp4")
                .setFileType(FileType.VIDEO)
                .setFileSizeBytes(201L) // above the 200-byte test general limit
                .build()))
                .isInstanceOfSatisfying(StatusRuntimeException.class,
                        e -> assertThat(e.getStatus().getCode()).isEqualTo(Status.Code.INVALID_ARGUMENT));
    }

    @Test
    void getPresignedUploadUrl_rejectsAudioAboveGroqLimit_butAllowsSameSizeForVideo() {
        UploadServiceGrpc.UploadServiceBlockingStub stub = stubFor(UUID.randomUUID());
        long sizeBetweenAudioAndGeneralLimit = 150L; // above the 100-byte audio limit, below the 200-byte general limit

        assertThatThrownBy(() -> stub.getPresignedUploadUrl(GetPresignedUploadUrlRequest.newBuilder()
                .setFileName("long-podcast.mp3")
                .setFileType(FileType.AUDIO)
                .setFileSizeBytes(sizeBetweenAudioAndGeneralLimit)
                .build()))
                .isInstanceOfSatisfying(StatusRuntimeException.class,
                        e -> assertThat(e.getStatus().getCode()).isEqualTo(Status.Code.INVALID_ARGUMENT));

        // 同一個大小的 VIDEO 上傳不受音訊專用上限影響——只受濫用防護上限（200 bytes）約束。
        GetPresignedUploadUrlResponse videoPresigned = stub.getPresignedUploadUrl(GetPresignedUploadUrlRequest.newBuilder()
                .setFileName("clip.mp4")
                .setFileType(FileType.VIDEO)
                .setFileSizeBytes(sizeBetweenAudioAndGeneralLimit)
                .build());
        assertThat(videoPresigned.getStoragePath()).startsWith("uploads/");
    }

    @Test
    void completeUpload_rejectsAndDeletesObject_whenActualUploadedSizeExceedsLimit() throws Exception {
        UploadServiceGrpc.UploadServiceBlockingStub stub = stubFor(UUID.randomUUID());

        // presign 用一個過關的宣告大小，但實際 PUT 的位元組數超過上限——驗證 completeUpload()
        // 是拿物件儲存實際存的大小做檢查，不是信任呼叫端在請求裡回報的數字。
        GetPresignedUploadUrlResponse presigned = stub.getPresignedUploadUrl(GetPresignedUploadUrlRequest.newBuilder()
                .setFileName("lying-about-size.mp3")
                .setFileType(FileType.AUDIO)
                .setFileSizeBytes(10L)
                .build());
        String oversizedBody = "x".repeat(150); // exceeds the 100-byte test audio limit
        putBytes(presigned.getUploadUrl(), oversizedBody);

        assertThatThrownBy(() -> stub.completeUpload(CompleteUploadRequest.newBuilder()
                .setStoragePath(presigned.getStoragePath())
                .setFileName("lying-about-size.mp3")
                .setFileType(FileType.AUDIO)
                .setFileSizeBytes(10L) // still lying — completeUpload should ignore this and check storage directly
                .build()))
                .isInstanceOfSatisfying(StatusRuntimeException.class,
                        e -> assertThat(e.getStatus().getCode()).isEqualTo(Status.Code.INVALID_ARGUMENT));

        assertThat(storageService.headObjectSize(presigned.getStoragePath()))
                .as("oversized object should have been deleted from storage")
                .isEmpty();
    }

    @Test
    void completeUpload_succeeds_whenActualUploadedSizeIsWithinLimit() throws Exception {
        UploadServiceGrpc.UploadServiceBlockingStub stub = stubFor(UUID.randomUUID());

        GetPresignedUploadUrlResponse presigned = stub.getPresignedUploadUrl(GetPresignedUploadUrlRequest.newBuilder()
                .setFileName("fits.mp3")
                .setFileType(FileType.AUDIO)
                .setFileSizeBytes(10L)
                .build());
        String smallBody = "x".repeat(50); // within the 100-byte test audio limit
        putBytes(presigned.getUploadUrl(), smallBody);

        var job = stub.completeUpload(CompleteUploadRequest.newBuilder()
                .setStoragePath(presigned.getStoragePath())
                .setFileName("fits.mp3")
                .setFileType(FileType.AUDIO)
                .setFileSizeBytes(10L) // deliberately wrong — persisted value should come from storage, not this
                .build());
        createdJobIds.add(UUID.fromString(job.getJobId()));

        assertThat(job.getFileSizeBytes()).isEqualTo(50L);
    }

    private UploadServiceGrpc.UploadServiceBlockingStub stubFor(UUID userId) {
        Channel channel = channelFactory.createChannel("upload-service");
        return UploadServiceGrpc.newBlockingStub(channel)
                .withInterceptors(new UserIdHeaderInterceptor(userId.toString()));
    }

    private static void putBytes(String uploadUrl, String body) throws Exception {
        HttpResponse<String> response = HttpClient.newHttpClient().send(
                HttpRequest.newBuilder(URI.create(uploadUrl)).PUT(HttpRequest.BodyPublishers.ofString(body)).build(),
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
