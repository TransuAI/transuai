package com.transuai.upload_service.grpc;

import io.grpc.Status;

public final class JobMapper {

    private JobMapper() {
    }

    public static com.transuai.upload_service.domain.FileType toDomain(com.transuai.upload.grpc.v1.FileType fileType) {
        return switch (fileType) {
            case AUDIO -> com.transuai.upload_service.domain.FileType.AUDIO;
            case VIDEO -> com.transuai.upload_service.domain.FileType.VIDEO;
            case FILE_TYPE_UNSPECIFIED, UNRECOGNIZED ->
                throw Status.INVALID_ARGUMENT.withDescription("unsupported file_type: " + fileType)
                        .asRuntimeException();
        };
    }

    public static com.transuai.upload.grpc.v1.FileType toProto(com.transuai.upload_service.domain.FileType fileType) {
        return switch (fileType) {
            case AUDIO -> com.transuai.upload.grpc.v1.FileType.AUDIO;
            case VIDEO -> com.transuai.upload.grpc.v1.FileType.VIDEO;
        };
    }

    public static com.transuai.upload.grpc.v1.JobStatus toProto(com.transuai.upload_service.domain.JobStatus status) {
        return com.transuai.upload.grpc.v1.JobStatus.valueOf(status.name());
    }

    public static com.transuai.upload.grpc.v1.Job toProto(com.transuai.upload_service.domain.Job job) {
        com.transuai.upload.grpc.v1.Job.Builder builder = com.transuai.upload.grpc.v1.Job.newBuilder()
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
        return builder.build();
    }
}
