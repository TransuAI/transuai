package com.transuai.upload_service.grpc;

import java.util.UUID;

import com.transuai.upload.grpc.v1.InternalJobServiceGrpc;
import com.transuai.upload.grpc.v1.Job;
import com.transuai.upload.grpc.v1.SetSuggestedDetailsRequest;
import com.transuai.upload.grpc.v1.UpdateJobStatusRequest;
import com.transuai.upload_service.domain.JobCategory;
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

    // 跟 jobs.title 欄位一樣長；AI 取的標題本來就短得多（ai-service 截到 40 字）。
    static final int MAX_TITLE_LENGTH = 100;

    private final JobRepository jobRepository;

    @Override
    public void updateJobStatus(UpdateJobStatusRequest request, StreamObserver<Job> responseObserver) {
        JobEntity job = findJob(request.getJobId());

        job.setStatus(JobMapper.toDomain(request.getStatus()));
        if (!request.getErrorReason().isBlank()) {
            job.setErrorReason(request.getErrorReason());
        }
        job = jobRepository.save(job);

        responseObserver.onNext(JobMapper.toProto(job));
        responseObserver.onCompleted();
    }

    // AI 依內容建議的標題與類型：使用者改過的欄位不動，空字串的欄位也不動（這次沒建議）。
    @Override
    public void setSuggestedDetails(SetSuggestedDetailsRequest request, StreamObserver<Job> responseObserver) {
        String category = request.getCategory();
        if (!category.isBlank() && !JobCategory.isKnown(category)) {
            throw Status.INVALID_ARGUMENT.withDescription("unknown category: " + category).asRuntimeException();
        }
        JobEntity job = findJob(request.getJobId());

        String title = request.getTitle().strip();
        if (!title.isEmpty() && !Boolean.TRUE.equals(job.getTitleSetByUser())) {
            job.setTitle(title.length() > MAX_TITLE_LENGTH ? title.substring(0, MAX_TITLE_LENGTH) : title);
        }
        if (!category.isBlank() && !Boolean.TRUE.equals(job.getCategorySetByUser())) {
            job.setCategory(category);
        }
        job = jobRepository.save(job);

        responseObserver.onNext(JobMapper.toProto(job));
        responseObserver.onCompleted();
    }

    private JobEntity findJob(String rawJobId) {
        UUID jobId;
        try {
            jobId = UUID.fromString(rawJobId);
        } catch (IllegalArgumentException e) {
            throw Status.INVALID_ARGUMENT.withDescription("job_id must be a valid UUID").asRuntimeException();
        }
        return jobRepository.findById(jobId)
                .orElseThrow(() -> Status.NOT_FOUND.withDescription("job not found").asRuntimeException());
    }
}
