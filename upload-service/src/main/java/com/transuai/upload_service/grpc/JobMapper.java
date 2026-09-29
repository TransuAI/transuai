package com.transuai.upload_service.grpc;

import com.transuai.upload.grpc.v1.FileType;
import com.transuai.upload.grpc.v1.Job;
import com.transuai.upload.grpc.v1.JobStatus;
import com.transuai.upload_service.domain.JobEntity;

import io.grpc.Status;

public final class JobMapper {

    private JobMapper() {
    }

    public static JobEntity.FileType toDomain(FileType fileType) {
        return switch (fileType) {
            case AUDIO -> JobEntity.FileType.AUDIO;
            case VIDEO -> JobEntity.FileType.VIDEO;
            case FILE_TYPE_UNSPECIFIED, UNRECOGNIZED ->
                throw Status.INVALID_ARGUMENT.withDescription("unsupported file_type: " + fileType)
                        .asRuntimeException();
        };
    }

    public static FileType toProto(JobEntity.FileType fileType) {
        return switch (fileType) {
            case AUDIO -> FileType.AUDIO;
            case VIDEO -> FileType.VIDEO;
        };
    }

    public static JobStatus toProto(JobEntity.Status status) {
        return JobStatus.valueOf(status.name());
    }

    public static JobEntity.Status toDomain(JobStatus status) {
        return switch (status) {
            case PENDING -> JobEntity.Status.PENDING;
            case UPLOADING -> JobEntity.Status.UPLOADING;
            case UPLOADED -> JobEntity.Status.UPLOADED;
            case TRANSCRIBING -> JobEntity.Status.TRANSCRIBING;
            case TRANSCRIBED -> JobEntity.Status.TRANSCRIBED;
            case SUMMARIZING -> JobEntity.Status.SUMMARIZING;
            case COMPLETED -> JobEntity.Status.COMPLETED;
            case FAILED -> JobEntity.Status.FAILED;
            case JOB_STATUS_UNSPECIFIED, UNRECOGNIZED ->
                throw Status.INVALID_ARGUMENT.withDescription("unsupported status: " + status).asRuntimeException();
        };
    }

    public static Job toProto(JobEntity job) {
        Job.Builder builder = Job.newBuilder()
                .setJobId(job.getId().toString())
                .setUserId(job.getUserId().toString())
                .setFileName(job.getFileName())
                .setFileType(toProto(job.getFileType()))
                .setFileSizeBytes(job.getFileSizeBytes())
                .setStoragePath(job.getStoragePath())
                .setStatus(toProto(job.getStatus()))
                .setCreatedAt(GrpcTimestamps.toProto(job.getCreatedAt()))
                .setUpdatedAt(GrpcTimestamps.toProto(job.getUpdatedAt()));

        if (job.getDurationSeconds() != null) {
            builder.setDurationSeconds(job.getDurationSeconds());
        }
        if (job.getErrorReason() != null) {
            builder.setErrorReason(job.getErrorReason());
        }
        if (job.getTranscriptionLanguage() != null) {
            builder.setTranscriptionLanguage(job.getTranscriptionLanguage());
        }
        if (job.getTitle() != null) {
            builder.setTitle(job.getTitle());
        }
        if (job.getCategory() != null) {
            builder.setCategory(job.getCategory());
        }
        return builder.build();
    }
}
