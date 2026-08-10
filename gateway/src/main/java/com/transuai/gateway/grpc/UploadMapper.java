package com.transuai.gateway.grpc;

import com.transuai.gateway.web.dto.JobDto;
import com.transuai.upload.grpc.v1.Job;

public final class UploadMapper {

    private UploadMapper() {
    }

    public static JobDto toDto(Job job) {
        return new JobDto(
                job.getJobId(),
                job.getUserId(),
                job.getFileName(),
                job.getFileType().name(),
                job.getFileSizeBytes(),
                job.getStoragePath(),
                job.getDurationSeconds(),
                job.getStatus().name(),
                job.getErrorReason(),
                GrpcTimestamps.toInstant(job.getCreatedAt()),
                GrpcTimestamps.toInstant(job.getUpdatedAt()));
    }
}
