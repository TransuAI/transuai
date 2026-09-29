package com.transuai.gateway.web;

import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import com.transuai.gateway.grpc.GrpcMetadataSupport;
import com.transuai.gateway.grpc.GrpcStrings;
import com.transuai.gateway.grpc.GrpcTimestamps;
import com.transuai.gateway.grpc.JobOwnershipGuard;
import com.transuai.gateway.grpc.UploadMapper;
import com.transuai.gateway.ratelimit.CostlyFeature;
import com.transuai.gateway.usage.UsageLimitGuard;
import com.transuai.gateway.web.dto.CompleteUploadRequestDto;
import com.transuai.gateway.web.dto.JobDto;
import com.transuai.gateway.web.dto.JobListResponseDto;
import com.transuai.gateway.web.dto.MediaUrlDto;
import com.transuai.gateway.web.dto.PresignRequestDto;
import com.transuai.gateway.web.dto.PresignResponseDto;
import com.transuai.gateway.web.dto.UpdateJobRequestDto;
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
import com.transuai.upload.grpc.v1.UpdateJobRequest;
import com.transuai.upload.grpc.v1.UploadServiceGrpc;

import lombok.RequiredArgsConstructor;

// 對應 ../../architecture-design.md 3.2。upload-service 本身只講 gRPC，這裡轉出 REST。
@RestController
@RequiredArgsConstructor
public class UploadController {

        private final UploadServiceGrpc.UploadServiceBlockingStub uploadServiceStub;
        private final UsageLimitGuard usageLimitGuard;
        private final JobOwnershipGuard jobOwnershipGuard;

        @CostlyFeature("upload-url")
        @PostMapping("/uploads/presign")
        public PresignResponseDto presign(@CurrentUserId UUID userId, @RequestBody PresignRequestDto request) {
                usageLimitGuard.requireTranscriptionLeft(userId, request.durationSeconds());
                GetPresignedUploadUrlResponse response = GrpcMetadataSupport.withUserId(uploadServiceStub, userId)
                                .getPresignedUploadUrl(GetPresignedUploadUrlRequest.newBuilder()
                                                .setFileName(request.fileName())
                                                .setFileType(FileType.valueOf(request.fileType()))
                                                .setFileSizeBytes(request.fileSizeBytes())
                                                .build());
                return new PresignResponseDto(response.getUploadUrl(), response.getStoragePath(),
                                GrpcTimestamps.toInstant(response.getExpiresAt()));
        }

        @CostlyFeature("upload")
        @PostMapping("/uploads/complete")
        public JobDto completeUpload(@CurrentUserId UUID userId, @RequestBody CompleteUploadRequestDto request) {
                usageLimitGuard.requireTranscriptionLeft(userId, request.durationSeconds());
                Job job = GrpcMetadataSupport.withUserId(uploadServiceStub, userId)
                                .completeUpload(CompleteUploadRequest.newBuilder()
                                                .setStoragePath(request.storagePath())
                                                .setFileName(request.fileName())
                                                .setFileType(FileType.valueOf(request.fileType()))
                                                .setFileSizeBytes(request.fileSizeBytes())
                                                .setDurationSeconds(request.durationSeconds())
                                                .setTranscriptionLanguage(
                                                                GrpcStrings.nullToEmpty(request.transcriptionLanguage()))
                                                .build());
                return UploadMapper.toDto(job);
        }

        @GetMapping("/jobs/{jobId}")
        public JobDto getJob(@CurrentUserId UUID userId, @PathVariable String jobId) {
                Job job = GrpcMetadataSupport.withUserId(uploadServiceStub, userId)
                                .getJob(GetJobRequest.newBuilder().setJobId(jobId).build());
                return UploadMapper.toDto(job);
        }

        // 使用者改標題／類型（見 upload-service CONTEXT.md）：改過的欄位 AI 之後不會再寫。ownership 由 upload-service 依 x-user-id 檢查。
        @PatchMapping("/jobs/{jobId}")
        public JobDto updateJob(@CurrentUserId UUID userId, @PathVariable String jobId,
                        @RequestBody UpdateJobRequestDto request) {
                UpdateJobRequest.Builder update = UpdateJobRequest.newBuilder().setJobId(jobId);
                if (request.title() != null) {
                        update.setTitle(request.title());
                }
                if (request.category() != null) {
                        update.setCategory(request.category());
                }
                Job job = GrpcMetadataSupport.withUserId(uploadServiceStub, userId).updateJob(update.build());
                return UploadMapper.toDto(job);
        }

        // download=true：URL 會讓瀏覽器直接下載、存成原始檔名（匯出 → 下載原始檔）；預設給播放器 inline 讀取。
        @GetMapping("/jobs/{jobId}/media-url")
        public MediaUrlDto getMediaUrl(@CurrentUserId UUID userId, @PathVariable String jobId,
                        @RequestParam(defaultValue = "false") boolean download) {
                GetPresignedDownloadUrlResponse response = GrpcMetadataSupport.withUserId(uploadServiceStub, userId)
                                .getPresignedDownloadUrl(GetPresignedDownloadUrlRequest.newBuilder()
                                                .setJobId(jobId)
                                                .setAsAttachment(download)
                                                .build());
                return new MediaUrlDto(response.getDownloadUrl(), GrpcTimestamps.toInstant(response.getExpiresAt()));
        }

        @GetMapping("/jobs")
        public JobListResponseDto listJobs(@CurrentUserId UUID userId,
                        @RequestParam(defaultValue = "0") int page, @RequestParam(defaultValue = "0") int pageSize,
                        @RequestParam(defaultValue = "") String query, @RequestParam(defaultValue = "") String category) {
                // query：標題或檔名包含它的；category：只看某個類型。空字串不篩，由 upload-service 處理。
                ListJobsResponse response = GrpcMetadataSupport.withUserId(uploadServiceStub, userId)
                                .listJobs(ListJobsRequest.newBuilder().setPage(page).setPageSize(pageSize)
                                                .setQuery(query).setCategory(category).build());
                return new JobListResponseDto(
                                response.getJobsList().stream().map(UploadMapper::toDto).toList(),
                                response.getTotalCount(), response.getPage(), response.getPageSize());
        }

        @DeleteMapping("/jobs/{jobId}")
        @ResponseStatus(HttpStatus.NO_CONTENT)
        public void deleteJob(@CurrentUserId UUID userId, @PathVariable String jobId) {
                GrpcMetadataSupport.withUserId(uploadServiceStub, userId)
                                .deleteJob(DeleteJobRequest.newBuilder().setJobId(jobId).build());
                jobOwnershipGuard.forget(jobId);
        }
}
