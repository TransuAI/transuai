package com.transuai.upload_service.grpc;

import java.util.Optional;
import java.util.UUID;

import com.transuai.upload.grpc.v1.CompleteUploadRequest;
import com.transuai.upload.grpc.v1.DeleteJobRequest;
import com.transuai.upload.grpc.v1.FileType;
import com.transuai.upload.grpc.v1.GetJobRequest;
import com.transuai.upload.grpc.v1.GetPresignedDownloadUrlRequest;
import com.transuai.upload.grpc.v1.GetPresignedDownloadUrlResponse;
import com.transuai.upload.grpc.v1.GetPresignedUploadUrlRequest;
import com.transuai.upload.grpc.v1.GetPresignedUploadUrlResponse;
import com.transuai.upload.grpc.v1.Job;
import com.transuai.upload.grpc.v1.ListJobsRequest;
import com.transuai.upload.grpc.v1.ListJobsResponse;
import com.transuai.upload.grpc.v1.UploadServiceGrpc;
import com.transuai.upload_service.config.UploadLimitsProperties;
import com.transuai.upload_service.domain.JobEntity;
import com.transuai.upload_service.domain.TranscriptionLanguage;
import com.transuai.upload_service.event.JobEventPublisher;
import com.transuai.upload_service.event.TranscriptionRequestedEvent;
import com.transuai.upload_service.grpc.auth.GrpcAuthContext;
import com.transuai.upload_service.repository.JobRepository;
import com.transuai.upload_service.service.StorageService;

import com.google.protobuf.Empty;
import io.grpc.Status;
import io.grpc.stub.StreamObserver;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.grpc.server.service.GrpcService;

// 例外映射統一處理留待後續 task（跨切面）補上。
@GrpcService
@RequiredArgsConstructor
@Slf4j
public class UploadGrpcService extends UploadServiceGrpc.UploadServiceImplBase {

    private static final int DEFAULT_PAGE_SIZE = 20;
    private static final int MAX_PAGE_SIZE = 100;

    private final StorageService storageService;
    private final JobRepository jobRepository;
    private final JobEventPublisher jobEventPublisher;
    private final UploadLimitsProperties uploadLimitsProperties;

    @Override
    public void getPresignedUploadUrl(GetPresignedUploadUrlRequest request,
            StreamObserver<GetPresignedUploadUrlResponse> responseObserver) {
        if (request.getFileName().isBlank()) {
            responseObserver.onError(
                    Status.INVALID_ARGUMENT.withDescription("file_name is required").asRuntimeException());
            return;
        }
        if (request.getFileType() == FileType.FILE_TYPE_UNSPECIFIED) {
            responseObserver.onError(
                    Status.INVALID_ARGUMENT.withDescription("file_type is required").asRuntimeException());
            return;
        }
        if (request.getFileSizeBytes() <= 0) {
            responseObserver.onError(
                    Status.INVALID_ARGUMENT.withDescription("file_size_bytes must be positive").asRuntimeException());
            return;
        }
        long presignMaxFileSizeBytes = uploadLimitsProperties.applicableMaxFileSizeBytes(request.getFileType());
        if (request.getFileSizeBytes() > presignMaxFileSizeBytes) {
            responseObserver.onError(Status.INVALID_ARGUMENT
                    .withDescription("file_size_bytes exceeds the maximum allowed upload size for this file type (%d bytes)"
                            .formatted(presignMaxFileSizeBytes))
                    .asRuntimeException());
            return;
        }

        UUID userId = GrpcAuthContext.currentUserId();
        String objectKey = StorageService.buildObjectKey(userId, request.getFileName());
        StorageService.PresignedUpload presigned = storageService.createPresignedUploadUrl(objectKey);

        responseObserver.onNext(GetPresignedUploadUrlResponse.newBuilder()
                .setUploadUrl(presigned.uploadUrl())
                .setStoragePath(presigned.objectKey())
                .setExpiresAt(GrpcTimestamps.toProto(presigned.expiresAt()))
                .build());
        responseObserver.onCompleted();
    }

    @Override
    public void completeUpload(CompleteUploadRequest request, StreamObserver<Job> responseObserver) {
        if (request.getStoragePath().isBlank()) {
            responseObserver.onError(
                    Status.INVALID_ARGUMENT.withDescription("storage_path is required").asRuntimeException());
            return;
        }
        if (request.getFileName().isBlank()) {
            responseObserver.onError(
                    Status.INVALID_ARGUMENT.withDescription("file_name is required").asRuntimeException());
            return;
        }
        if (request.getFileType() == FileType.FILE_TYPE_UNSPECIFIED) {
            responseObserver.onError(
                    Status.INVALID_ARGUMENT.withDescription("file_type is required").asRuntimeException());
            return;
        }
        if (request.getFileSizeBytes() <= 0) {
            responseObserver.onError(
                    Status.INVALID_ARGUMENT.withDescription("file_size_bytes must be positive").asRuntimeException());
            return;
        }
        Optional<String> transcriptionLanguage = TranscriptionLanguage.parse(request.getTranscriptionLanguage());
        if (transcriptionLanguage.isEmpty()) {
            responseObserver.onError(Status.INVALID_ARGUMENT
                    .withDescription("transcription_language must be zh-TW, en or auto").asRuntimeException());
            return;
        }

        UUID userId = GrpcAuthContext.currentUserId();
        String expectedPrefix = "uploads/" + userId + "/";
        if (!request.getStoragePath().startsWith(expectedPrefix)) {
            responseObserver.onError(Status.PERMISSION_DENIED
                    .withDescription("storage_path does not belong to caller").asRuntimeException());
            return;
        }
        // request.getFileSizeBytes() 是呼叫端自己回報的數字，完全不可信——這裡改問物件儲存實際存了
        // 多大，size 限制才是真的在擋東西，不是在擋一個呼叫端可以隨便亂填的欄位。
        Optional<Long> actualFileSizeBytes = storageService.headObjectSize(request.getStoragePath());
        if (actualFileSizeBytes.isEmpty()) {
            responseObserver.onError(Status.FAILED_PRECONDITION
                    .withDescription("object not found in storage; upload may not have completed yet")
                    .asRuntimeException());
            return;
        }
        long applicableMaxFileSizeBytes = uploadLimitsProperties.applicableMaxFileSizeBytes(request.getFileType());
        if (actualFileSizeBytes.get() > applicableMaxFileSizeBytes) {
            // 濫用防護上限用意在擋住真正上傳進來的東西，物件已經確定超標就沒有理由留著佔儲存空間——
            // 跟 deleteJob() 同一套「刪除失敗只記警告、不擋主要流程」模式。
            try {
                storageService.deleteObject(request.getStoragePath());
            } catch (RuntimeException e) {
                log.warn("failed to delete oversized storage object {}", request.getStoragePath(), e);
            }
            responseObserver.onError(Status.INVALID_ARGUMENT
                    .withDescription("uploaded object exceeds the maximum allowed size (%d bytes)"
                            .formatted(applicableMaxFileSizeBytes))
                    .asRuntimeException());
            return;
        }

        JobEntity job = JobEntity.builder()
                .userId(userId)
                .fileName(request.getFileName())
                .fileType(JobMapper.toDomain(request.getFileType()))
                .fileSizeBytes(actualFileSizeBytes.get())
                .storagePath(request.getStoragePath())
                .durationSeconds(request.getDurationSeconds() > 0 ? request.getDurationSeconds() : null)
                .transcriptionLanguage(transcriptionLanguage.get())
                .status(JobEntity.Status.UPLOADED)
                .build();
        job = jobRepository.save(job);

        jobEventPublisher.publishTranscriptionRequested(new TranscriptionRequestedEvent(
                job.getId().toString(), job.getUserId().toString(), job.getStoragePath(), job.getFileType().name(),
                job.getTranscriptionLanguage()));

        responseObserver.onNext(JobMapper.toProto(job));
        responseObserver.onCompleted();
    }

    @Override
    public void getJob(GetJobRequest request, StreamObserver<Job> responseObserver) {
        UUID userId = GrpcAuthContext.currentUserId();
        UUID jobId = parseJobId(request.getJobId(), responseObserver);
        if (jobId == null) {
            return;
        }

        JobEntity job = jobRepository.findByIdAndUserId(jobId, userId)
                .orElse(null);
        if (job == null) {
            responseObserver.onError(Status.NOT_FOUND.withDescription("job not found").asRuntimeException());
            return;
        }

        responseObserver.onNext(JobMapper.toProto(job));
        responseObserver.onCompleted();
    }

    @Override
    public void getPresignedDownloadUrl(GetPresignedDownloadUrlRequest request,
            StreamObserver<GetPresignedDownloadUrlResponse> responseObserver) {
        UUID userId = GrpcAuthContext.currentUserId();
        UUID jobId = parseJobId(request.getJobId(), responseObserver);
        if (jobId == null) {
            return;
        }

        JobEntity job = jobRepository.findByIdAndUserId(jobId, userId).orElse(null);
        if (job == null) {
            responseObserver.onError(Status.NOT_FOUND.withDescription("job not found").asRuntimeException());
            return;
        }

        StorageService.PresignedDownload presigned = request.getAsAttachment()
                ? storageService.createPresignedAttachmentUrl(job.getStoragePath(), job.getFileName())
                : storageService.createPresignedDownloadUrl(job.getStoragePath());

        responseObserver.onNext(GetPresignedDownloadUrlResponse.newBuilder()
                .setDownloadUrl(presigned.downloadUrl())
                .setExpiresAt(GrpcTimestamps.toProto(presigned.expiresAt()))
                .build());
        responseObserver.onCompleted();
    }

    @Override
    public void listJobs(ListJobsRequest request, StreamObserver<ListJobsResponse> responseObserver) {
        UUID userId = GrpcAuthContext.currentUserId();

        int page = request.getPage() > 0 ? request.getPage() : 1;
        int pageSize = request.getPageSize() > 0 ? Math.min(request.getPageSize(), MAX_PAGE_SIZE) : DEFAULT_PAGE_SIZE;

        Page<JobEntity> result = jobRepository.findByUserIdOrderByCreatedAtDesc(userId,
                PageRequest.of(page - 1, pageSize));

        ListJobsResponse.Builder builder = ListJobsResponse.newBuilder()
                .setTotalCount((int) result.getTotalElements())
                .setPage(page)
                .setPageSize(pageSize);
        result.getContent().forEach(job -> builder.addJobs(JobMapper.toProto(job)));

        responseObserver.onNext(builder.build());
        responseObserver.onCompleted();
    }

    private static UUID parseJobId(String rawJobId, StreamObserver<?> responseObserver) {
        try {
            return UUID.fromString(rawJobId);
        } catch (IllegalArgumentException e) {
            responseObserver.onError(
                    Status.INVALID_ARGUMENT.withDescription("job_id must be a valid UUID").asRuntimeException());
            return null;
        }
    }

    @Override
    public void deleteJob(DeleteJobRequest request, StreamObserver<Empty> responseObserver) {
        UUID userId = GrpcAuthContext.currentUserId();
        UUID jobId = parseJobId(request.getJobId(), responseObserver);
        if (jobId == null) {
            return;
        }

        JobEntity job = jobRepository.findByIdAndUserId(jobId, userId).orElse(null);
        if (job == null) {
            responseObserver.onError(Status.NOT_FOUND.withDescription("job not found").asRuntimeException());
            return;
        }

        // 物件儲存刪除失敗只記警告、不擋刪除：使用者的刪除意圖優先，孤兒物件之後可靠背景清理排除。
        try {
            storageService.deleteObject(job.getStoragePath());
        } catch (RuntimeException e) {
            log.warn("failed to delete storage object {} for job {}", job.getStoragePath(), job.getId(), e);
        }
        jobRepository.delete(job);

        responseObserver.onNext(Empty.getDefaultInstance());
        responseObserver.onCompleted();
    }
}
