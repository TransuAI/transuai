package com.transuai.upload_service.grpc;

import java.util.UUID;

import com.transuai.upload.grpc.v1.InternalJobServiceGrpc;
import com.transuai.upload.grpc.v1.Job;
import com.transuai.upload.grpc.v1.UpdateJobStatusRequest;
import com.transuai.upload_service.domain.JobEntity;
import com.transuai.upload_service.repository.JobRepository;

import io.grpc.Status;
import io.grpc.stub.StreamObserver;
import lombok.RequiredArgsConstructor;
import org.springframework.grpc.server.service.GrpcService;

// 供 pipeline 下游服務（Transcription Service / AI Service）回呼，呼叫方只有 job_id、
// 沒有終端使用者身分，因此不走 GrpcAuthContext，改用 jobRepository.findById 查詢。
@GrpcService
@RequiredArgsConstructor
public class InternalJobGrpcService extends InternalJobServiceGrpc.InternalJobServiceImplBase {

    private final JobRepository jobRepository;

    @Override
    public void updateJobStatus(UpdateJobStatusRequest request, StreamObserver<Job> responseObserver) {
        UUID jobId;
        try {
            jobId = UUID.fromString(request.getJobId());
        } catch (IllegalArgumentException e) {
            responseObserver.onError(
                    Status.INVALID_ARGUMENT.withDescription("job_id must be a valid UUID").asRuntimeException());
            return;
        }

        JobEntity job = jobRepository.findById(jobId).orElse(null);
        if (job == null) {
            responseObserver.onError(Status.NOT_FOUND.withDescription("job not found").asRuntimeException());
            return;
        }

        job.setStatus(JobMapper.toDomain(request.getStatus()));
        if (!request.getErrorReason().isBlank()) {
            job.setErrorReason(request.getErrorReason());
        }
        job = jobRepository.save(job);

        responseObserver.onNext(JobMapper.toProto(job));
        responseObserver.onCompleted();
    }
}
