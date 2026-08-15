package com.transuai.gateway.web;

import java.util.UUID;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import com.transuai.gateway.grpc.GrpcMetadataSupport;
import com.transuai.gateway.grpc.GrpcTimestamps;
import com.transuai.gateway.grpc.UploadMapper;
import com.transuai.gateway.web.dto.CompleteUploadRequestDto;
import com.transuai.gateway.web.dto.JobDto;
import com.transuai.gateway.web.dto.JobListResponseDto;
import com.transuai.gateway.web.dto.MediaUrlDto;
import com.transuai.gateway.web.dto.PresignRequestDto;
import com.transuai.gateway.web.dto.PresignResponseDto;
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

import lombok.RequiredArgsConstructor;

// 對應 ../../architecture-design.md 3.2。upload-service 本身只講 gRPC，這裡轉出 REST。
@RestController
@RequiredArgsConstructor
public class UploadController {

        private final UploadServiceGrpc.UploadServiceBlockingStub uploadServiceStub;

        @PostMapping("/uploads/presign")
        public PresignResponseDto presign(@CurrentUserId UUID userId, @RequestBody PresignRequestDto request) {
                GetPresignedUploadUrlResponse response = GrpcMetadataSupport.withUserId(uploadServiceStub, userId)
                                .getPresignedUploadUrl(GetPresignedUploadUrlRequest.newBuilder()
                                                .setFileName(request.fileName())
                                                .setFileType(FileType.valueOf(request.fileType()))
                                                .setFileSizeBytes(request.fileSizeBytes())
                                                .build());
                return new PresignResponseDto(response.getUploadUrl(), response.getStoragePath(),
                                GrpcTimestamps.toInstant(response.getExpiresAt()));
        }

        @PostMapping("/uploads/complete")
        public JobDto completeUpload(@CurrentUserId UUID userId, @RequestBody CompleteUploadRequestDto request) {
                Job job = GrpcMetadataSupport.withUserId(uploadServiceStub, userId)
                                .completeUpload(CompleteUploadRequest.newBuilder()
                                                .setStoragePath(request.storagePath())
                                                .setFileName(request.fileName())
                                                .setFileType(FileType.valueOf(request.fileType()))
                                                .setFileSizeBytes(request.fileSizeBytes())
                                                .setDurationSeconds(request.durationSeconds())
                                                .build());
                return UploadMapper.toDto(job);
        }

        @GetMapping("/jobs/{jobId}")
        public JobDto getJob(@CurrentUserId UUID userId, @PathVariable String jobId) {
                Job job = GrpcMetadataSupport.withUserId(uploadServiceStub, userId)
                                .getJob(GetJobRequest.newBuilder().setJobId(jobId).build());
                return UploadMapper.toDto(job);
        }

        @GetMapping("/jobs/{jobId}/media-url")
        public MediaUrlDto getMediaUrl(@CurrentUserId UUID userId, @PathVariable String jobId) {
                GetPresignedDownloadUrlResponse response = GrpcMetadataSupport.withUserId(uploadServiceStub, userId)
                                .getPresignedDownloadUrl(
                                                GetPresignedDownloadUrlRequest.newBuilder().setJobId(jobId).build());
                return new MediaUrlDto(response.getDownloadUrl(), GrpcTimestamps.toInstant(response.getExpiresAt()));
        }

        @GetMapping("/jobs")
        public JobListResponseDto listJobs(@CurrentUserId UUID userId,
                        @RequestParam(defaultValue = "0") int page, @RequestParam(defaultValue = "0") int pageSize) {
                ListJobsResponse response = GrpcMetadataSupport.withUserId(uploadServiceStub, userId)
                                .listJobs(ListJobsRequest.newBuilder().setPage(page).setPageSize(pageSize).build());
                return new JobListResponseDto(
                                response.getJobsList().stream().map(UploadMapper::toDto).toList(),
                                response.getTotalCount(), response.getPage(), response.getPageSize());
        }

        @DeleteMapping("/jobs/{jobId}")
        @ResponseStatus(HttpStatus.NO_CONTENT)
        public void deleteJob(@CurrentUserId UUID userId, @PathVariable String jobId) {
                GrpcMetadataSupport.withUserId(uploadServiceStub, userId)
                                .deleteJob(DeleteJobRequest.newBuilder().setJobId(jobId).build());
        }
}
