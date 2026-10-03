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
import org.springframework.amqp.core.AmqpAdmin;
import org.springframework.amqp.core.BindingBuilder;
import org.springframework.amqp.core.FanoutExchange;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.core.Queue;
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
import com.transuai.upload.grpc.v1.GetPresignedDownloadUrlRequest;
import com.transuai.upload.grpc.v1.GetPresignedUploadUrlRequest;
import com.transuai.upload.grpc.v1.GetPresignedUploadUrlResponse;
import com.transuai.upload.grpc.v1.InternalJobServiceGrpc;
import com.transuai.upload.grpc.v1.Job;
import com.transuai.upload.grpc.v1.JobStatus;
import com.transuai.upload.grpc.v1.ListJobsRequest;
import com.transuai.upload.grpc.v1.ListJobsResponse;
import com.transuai.upload.grpc.v1.SetSuggestedDetailsRequest;
import com.transuai.upload.grpc.v1.UpdateJobRequest;
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

    @Autowired
    private AmqpAdmin amqpAdmin;

    @Autowired
    private com.transuai.upload_service.repository.OutboxEventRepository outbox;

    private final ObjectMapper objectMapper = new ObjectMapper();
    private final List<UUID> createdJobIds = new ArrayList<>();
    private final List<String> testQueues = new ArrayList<>();

    // JUnit 5 透過反射在每個 @Test 執行後呼叫，不會有直接的呼叫端，IDE 的「unused」偵測看不到這點。
    @SuppressWarnings("unused")
    @AfterEach
    void cleanUp() {
        createdJobIds.forEach(jobRepository::deleteById);
        createdJobIds.clear();
        testQueues.forEach(amqpAdmin::deleteQueue);
        testQueues.clear();
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
        UUID userId = UUID.randomUUID();
        UploadServiceGrpc.UploadServiceBlockingStub stub = stubFor(userId);

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
        // Carried down the pipeline so ai-service knows whose models to use and whose usage it is.
        assertThat(payload.get("userId").asText()).isEqualTo(userId.toString());
        // No language asked for: Chinese, as before.
        assertThat(job.getTranscriptionLanguage()).isEqualTo("zh-TW");
        assertThat(payload.get("transcriptionLanguage").asText()).isEqualTo("zh-TW");
    }

    @Test
    void completeUpload_keepsTheChosenTranscriptionLanguageAndPassesItOn() throws Exception {
        for (String language : List.of("en", "auto")) {
            Job job = uploadedJob(stubFor(UUID.randomUUID()), "meeting-" + language + ".m4a", language);

            assertThat(job.getTranscriptionLanguage()).isEqualTo(language);
            Message message = rabbitTemplate.receive(mqProperties.transcriptionRequestedQueue(), 2000);
            assertThat(message).isNotNull();
            assertThat(objectMapper.readTree(message.getBody()).get("transcriptionLanguage").asText()).isEqualTo(language);
            assertThat(stubFor(UUID.fromString(job.getUserId())).getJob(
                    GetJobRequest.newBuilder().setJobId(job.getJobId()).build()).getTranscriptionLanguage())
                    .isEqualTo(language);
        }
    }

    @Test
    void completeUpload_rejectsAnUnknownTranscriptionLanguage() throws Exception {
        assertThatThrownBy(() -> uploadedJob(stubFor(UUID.randomUUID()), "meeting.m4a", "fr"))
                .isInstanceOfSatisfying(StatusRuntimeException.class,
                        e -> assertThat(e.getStatus().getCode()).isEqualTo(Status.Code.INVALID_ARGUMENT));
        assertThat(rabbitTemplate.receive(mqProperties.transcriptionRequestedQueue(), 500)).isNull();
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

    @SuppressWarnings("null")
    @Test
    void listJobs_findsJobsWhoseTitleOrFileNameContainsTheQuery_ignoringCase() throws Exception {
        UUID userId = UUID.randomUUID();
        Job byTitle = titledJob(userId, "REC_0012.m4a", "Product Weekly：上傳失敗", "meeting");
        Job byFileName = titledJob(userId, "product-demo.mp4", "新功能展示", "video");
        titledJob(userId, "lecture-03.m4a", "線性代數第三講", "lecture");
        createJob(UUID.randomUUID(), "product-someone-elses.mp3");

        ListJobsResponse response = stubFor(userId).listJobs(ListJobsRequest.newBuilder().setQuery("  PRODUCT ").build());

        assertThat(response.getTotalCount()).isEqualTo(2);
        assertThat(response.getJobsList()).extracting(Job::getJobId)
                .containsExactlyInAnyOrder(byTitle.getJobId(), byFileName.getJobId());
        assertThat(stubFor(userId).listJobs(ListJobsRequest.newBuilder().setQuery("上傳失敗").build()).getJobsList())
                .extracting(Job::getJobId).containsExactly(byTitle.getJobId());
    }

    @SuppressWarnings("null")
    @Test
    void listJobs_takesWildcardCharactersInTheQueryLiterally() throws Exception {
        UUID userId = UUID.randomUUID();
        Job percent = titledJob(userId, "a.m4a", "成長 100% 的祕密", "podcast");
        titledJob(userId, "b.m4a", "週會", "meeting");

        assertThat(stubFor(userId).listJobs(ListJobsRequest.newBuilder().setQuery("%").build()).getJobsList())
                .extracting(Job::getJobId).containsExactly(percent.getJobId());
        assertThat(stubFor(userId).listJobs(ListJobsRequest.newBuilder().setQuery("_").build()).getTotalCount()).isZero();
    }

    @SuppressWarnings("null")
    @Test
    void listJobs_filtersByCategory_andCountsAndPagesWithinTheFilter() throws Exception {
        UUID userId = UUID.randomUUID();
        Job first = titledJob(userId, "l1.m4a", "第一講", "lecture");
        titledJob(userId, "m1.m4a", "週會", "meeting");
        Job second = titledJob(userId, "l2.m4a", "第二講", "lecture");
        Job third = titledJob(userId, "l3.m4a", "第三講", "lecture");

        ListJobsResponse page1 = stubFor(userId).listJobs(
                ListJobsRequest.newBuilder().setCategory("lecture").setPage(1).setPageSize(2).build());
        ListJobsResponse page2 = stubFor(userId).listJobs(
                ListJobsRequest.newBuilder().setCategory("lecture").setPage(2).setPageSize(2).build());

        assertThat(page1.getTotalCount()).isEqualTo(3);
        assertThat(page1.getJobsList()).extracting(Job::getJobId).containsExactly(third.getJobId(), second.getJobId());
        assertThat(page2.getJobsList()).extracting(Job::getJobId).containsExactly(first.getJobId());
        assertThat(stubFor(userId).listJobs(ListJobsRequest.newBuilder().setCategory("lecture").setQuery("第二").build())
                .getJobsList()).extracting(Job::getJobId).containsExactly(second.getJobId());
    }

    @Test
    void listJobs_refusesACategoryNotOnTheList() {
        assertThatThrownBy(() -> stubFor(UUID.randomUUID()).listJobs(ListJobsRequest.newBuilder().setCategory("party").build()))
                .isInstanceOfSatisfying(StatusRuntimeException.class,
                        e -> assertThat(e.getStatus().getCode()).isEqualTo(Status.Code.INVALID_ARGUMENT));
    }

    @Test
    void updateJob_setsTheTitleAndCategoryTheUserChose_andTheAiNoLongerWritesThem() throws Exception {
        UUID userId = UUID.randomUUID();
        Job job = createJob(userId, "REC_0012.m4a");

        Job updated = stubFor(userId).updateJob(UpdateJobRequest.newBuilder()
                .setJobId(job.getJobId()).setTitle("  產品週會  ").setCategory("meeting").build());
        assertThat(updated.getTitle()).isEqualTo("產品週會");
        assertThat(updated.getCategory()).isEqualTo("meeting");

        Job afterAi = internalStub().setSuggestedDetails(SetSuggestedDetailsRequest.newBuilder()
                .setJobId(job.getJobId()).setTitle("AI 取的標題").setCategory("lecture").build());
        assertThat(afterAi.getTitle()).isEqualTo("產品週會");
        assertThat(afterAi.getCategory()).isEqualTo("meeting");
    }

    @Test
    void updateJob_leavesAFieldItDoesNotCarryAlone_soTheAiCanStillWriteIt() throws Exception {
        UUID userId = UUID.randomUUID();
        Job job = createJob(userId, "REC_0012.m4a");

        stubFor(userId).updateJob(UpdateJobRequest.newBuilder().setJobId(job.getJobId()).setCategory("lecture").build());
        Job afterAi = internalStub().setSuggestedDetails(SetSuggestedDetailsRequest.newBuilder()
                .setJobId(job.getJobId()).setTitle("線性代數第三講").setCategory("meeting").build());

        assertThat(afterAi.getTitle()).isEqualTo("線性代數第三講");
        assertThat(afterAi.getCategory()).isEqualTo("lecture");
    }

    @Test
    void updateJob_clearingTheTitleMeansNoTitle_andTheAiDoesNotFillItAgain() throws Exception {
        UUID userId = UUID.randomUUID();
        Job job = createJob(userId, "REC_0012.m4a");
        internalStub().setSuggestedDetails(SetSuggestedDetailsRequest.newBuilder()
                .setJobId(job.getJobId()).setTitle("AI 取的標題").build());

        Job cleared = stubFor(userId).updateJob(UpdateJobRequest.newBuilder().setJobId(job.getJobId()).setTitle(" ").build());
        assertThat(cleared.getTitle()).isEmpty();

        Job afterAi = internalStub().setSuggestedDetails(SetSuggestedDetailsRequest.newBuilder()
                .setJobId(job.getJobId()).setTitle("又一個標題").build());
        assertThat(afterAi.getTitle()).isEmpty();
    }

    @Test
    void updateJob_refusesATooLongTitleOrAnUnknownCategory() throws Exception {
        UUID userId = UUID.randomUUID();
        Job job = createJob(userId, "REC_0012.m4a");

        assertThatThrownBy(() -> stubFor(userId).updateJob(UpdateJobRequest.newBuilder()
                .setJobId(job.getJobId()).setTitle("字".repeat(101)).build()))
                .isInstanceOfSatisfying(StatusRuntimeException.class,
                        e -> assertThat(e.getStatus().getCode()).isEqualTo(Status.Code.INVALID_ARGUMENT));
        assertThatThrownBy(() -> stubFor(userId).updateJob(UpdateJobRequest.newBuilder()
                .setJobId(job.getJobId()).setCategory("party").build()))
                .isInstanceOfSatisfying(StatusRuntimeException.class,
                        e -> assertThat(e.getStatus().getCode()).isEqualTo(Status.Code.INVALID_ARGUMENT));
        assertThat(stubFor(userId).getJob(GetJobRequest.newBuilder().setJobId(job.getJobId()).build()).getTitle()).isEmpty();
    }

    @Test
    void updateJob_returnsNotFound_whenJobBelongsToAnotherUser() throws Exception {
        Job job = createJob(UUID.randomUUID(), "REC_0012.m4a");

        assertThatThrownBy(() -> stubFor(UUID.randomUUID()).updateJob(UpdateJobRequest.newBuilder()
                .setJobId(job.getJobId()).setTitle("偷改").build()))
                .isInstanceOfSatisfying(StatusRuntimeException.class,
                        e -> assertThat(e.getStatus().getCode()).isEqualTo(Status.Code.NOT_FOUND));
    }

    @Test
    void deleteJob_removesJobAndStorageObject() throws Exception {
        UUID userId = UUID.randomUUID();
        Job job = createJob(userId, "delete-me.mp3");
        UploadServiceGrpc.UploadServiceBlockingStub stub = stubFor(userId);
        String listener = listenToJobDeleted();

        Empty ignored = stub.deleteJob(DeleteJobRequest.newBuilder().setJobId(job.getJobId()).build());
        assertThat(ignored).isNotNull();
        createdJobIds.remove(UUID.fromString(job.getJobId()));

        assertThatThrownBy(() -> stub.getJob(GetJobRequest.newBuilder().setJobId(job.getJobId()).build()))
                .isInstanceOfSatisfying(StatusRuntimeException.class,
                        e -> assertThat(e.getStatus().getCode()).isEqualTo(Status.Code.NOT_FOUND));
        assertThat(jobRepository.findById(UUID.fromString(job.getJobId()))).isEmpty();

        // job.deleted 經 outbox 送到 fanout exchange，讓 transcription-service、ai-service 清掉自己的資料。
        var event = receiveJobDeleted(listener, job.getJobId()).get(job.getJobId());
        assertThat(event.get("userId").asText()).isEqualTo(userId.toString());
        assertThat(outbox.findAll()).noneMatch(row -> row.getPayload().contains(job.getJobId()));
    }

    @Test
    void deleteJob_ofSomeoneElsesJob_publishesNothing() throws Exception {
        Job job = createJob(UUID.randomUUID(), "not-yours.mp3");
        String listener = listenToJobDeleted();

        assertThatThrownBy(() -> stubFor(UUID.randomUUID()).deleteJob(
                DeleteJobRequest.newBuilder().setJobId(job.getJobId()).build()))
                .isInstanceOf(StatusRuntimeException.class);

        assertThat(rabbitTemplate.receive(listener, 2_000)).isNull();
        assertThat(jobRepository.findById(UUID.fromString(job.getJobId()))).isPresent();
    }

    @Test
    void accountDeleted_deletesAllOfThatUsersJobs_eachWithJobDeleted_andNoOneElses() throws Exception {
        UUID leaving = UUID.randomUUID();
        UUID staying = UUID.randomUUID();
        Job first = createJob(leaving, "a.mp3");
        Job second = createJob(leaving, "b.mp3");
        Job others = createJob(staying, "c.mp3");
        String listener = listenToJobDeleted();

        // 不合法的訊息收下就算了，不能卡住後面的
        rabbitTemplate.send(mqProperties.accountDeletedExchange(), "", new Message("not json".getBytes()));
        rabbitTemplate.send(mqProperties.accountDeletedExchange(), "",
                new Message(("{\"userId\":\"" + leaving + "\"}").getBytes()));

        receiveJobDeleted(listener, first.getJobId(), second.getJobId());
        assertThat(jobRepository.findAllByUserId(leaving)).isEmpty();
        assertThat(jobRepository.findById(UUID.fromString(others.getJobId()))).isPresent();
        createdJobIds.remove(UUID.fromString(first.getJobId()));
        createdJobIds.remove(UUID.fromString(second.getJobId()));
    }

    // 一個只給這個測試的佇列，綁到 job.deleted；測試結束刪掉（不用 auto-delete：第一次 receive 結束就會被 broker 刪掉）。
    private String listenToJobDeleted() {
        String queue = "test.job-deleted." + UUID.randomUUID();
        amqpAdmin.declareQueue(new Queue(queue, false, false, false));
        amqpAdmin.declareBinding(BindingBuilder.bind(new Queue(queue))
                .to(new FanoutExchange(mqProperties.jobDeletedExchange())));
        testQueues.add(queue);
        return queue;
    }

    // 等到這些 Job 的 job.deleted 都收到（順序不一定），回傳每個 Job 的事件內容。
    private java.util.Map<String, com.fasterxml.jackson.databind.JsonNode> receiveJobDeleted(String queue, String... jobIds)
            throws Exception {
        var wanted = java.util.Set.of(jobIds);
        var received = new java.util.HashMap<String, com.fasterxml.jackson.databind.JsonNode>();
        long deadline = System.currentTimeMillis() + 10_000;
        while (!received.keySet().containsAll(wanted) && System.currentTimeMillis() < deadline) {
            Message message = rabbitTemplate.receive(queue, 1_000);
            if (message != null) {
                var payload = objectMapper.readTree(message.getBody());
                received.put(payload.get("jobId").asText(), payload);
            }
        }
        assertThat(received.keySet()).as("job.deleted received").containsAll(wanted);
        return received;
    }

    @Test
    void getPresignedDownloadUrl_asAttachment_servesTheFileAsADownloadNamedAfterTheOriginal() throws Exception {
        UUID userId = UUID.randomUUID();
        Job job = createJob(userId, "週會 錄音.mp3");

        String url = stubFor(userId).getPresignedDownloadUrl(GetPresignedDownloadUrlRequest.newBuilder()
                .setJobId(job.getJobId())
                .setAsAttachment(true)
                .build()).getDownloadUrl();
        HttpResponse<String> response = get(url);

        assertThat(response.statusCode()).isEqualTo(200);
        assertThat(response.body()).isEqualTo("bytes");
        // RFC 6266 / 5987：ASCII 備援檔名，加上 percent-encode 過的 UTF-8 原始檔名。
        assertThat(response.headers().firstValue("Content-Disposition")).hasValue(
                "attachment; filename=\"__ __.mp3\"; filename*=UTF-8''%E9%80%B1%E6%9C%83%20%E9%8C%84%E9%9F%B3.mp3");
    }

    @Test
    void getPresignedDownloadUrl_withoutAttachment_isStillServedInlineForThePlayer() throws Exception {
        UUID userId = UUID.randomUUID();
        Job job = createJob(userId, "inline.mp3");

        String url = stubFor(userId).getPresignedDownloadUrl(GetPresignedDownloadUrlRequest.newBuilder()
                .setJobId(job.getJobId())
                .build()).getDownloadUrl();
        HttpResponse<String> response = get(url);

        assertThat(response.statusCode()).isEqualTo(200);
        assertThat(response.headers().firstValue("Content-Disposition")).isEmpty();
    }

    private Job createJob(UUID userId, String fileName) throws Exception {
        return uploadedJob(stubFor(userId), fileName, "");
    }

    // Uploads a small audio file and completes the upload, asking for the given transcription language ("" = none).
    private Job uploadedJob(UploadServiceGrpc.UploadServiceBlockingStub stub, String fileName, String language)
            throws Exception {
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
                .setTranscriptionLanguage(language)
                .build());
        createdJobIds.add(UUID.fromString(job.getJobId()));
        return job;
    }

    // A job the AI has already given a title and category.
    private Job titledJob(UUID userId, String fileName, String title, String category) throws Exception {
        Job job = createJob(userId, fileName);
        return internalStub().setSuggestedDetails(SetSuggestedDetailsRequest.newBuilder()
                .setJobId(job.getJobId()).setTitle(title).setCategory(category).build());
    }

    private InternalJobServiceGrpc.InternalJobServiceBlockingStub internalStub() {
        return InternalJobServiceGrpc.newBlockingStub(channelFactory.createChannel("upload-service"));
    }

    private UploadServiceGrpc.UploadServiceBlockingStub stubFor(UUID userId) {
        Channel channel = channelFactory.createChannel("upload-service");
        return UploadServiceGrpc.newBlockingStub(channel)
                .withInterceptors(new UserIdHeaderInterceptor(userId.toString()));
    }

    private static HttpResponse<String> get(String url) throws Exception {
        return HttpClient.newHttpClient().send(HttpRequest.newBuilder(URI.create(url)).GET().build(),
                HttpResponse.BodyHandlers.ofString());
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
