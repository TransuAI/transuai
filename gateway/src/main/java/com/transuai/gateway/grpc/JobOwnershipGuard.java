package com.transuai.gateway.grpc;

import java.util.UUID;

import org.springframework.stereotype.Component;

import com.transuai.upload.grpc.v1.GetJobRequest;
import com.transuai.upload.grpc.v1.Job;
import com.transuai.upload.grpc.v1.UploadServiceGrpc;

import lombok.RequiredArgsConstructor;

/**
 * transcription-service 的 GetTranscript、ai-service 的 GetSummary/ListChapters 本身不驗證
 * x-user-id（見對應 proto 的註解，只信任內部網路呼叫），呼叫前得先自己確認這個 job 是不是目前使用者的。
 * 直接借用 upload-service 的 GetJob——它本身就有 ownership 檢查，別人的 job 回 NOT_FOUND
 * （見 UploadController），不用在這裡重新實作一次比對邏輯。查不到就讓例外原樣往外冒，
 * GrpcExceptionAdvice 會轉成 404，呼叫端就不會再往下打到 transcription-service/ai-service。
 */
@Component
@RequiredArgsConstructor
public class JobOwnershipGuard {

    private final UploadServiceGrpc.UploadServiceBlockingStub uploadServiceStub;

    public void check(UUID userId, String jobId) {
        fetch(userId, jobId);
    }

    // 同樣的檢查，順便把 Job 本身交給需要它的呼叫端（例如會後處理要知道上傳時間）。
    public Job fetch(UUID userId, String jobId) {
        return GrpcMetadataSupport.withUserId(uploadServiceStub, userId)
                .getJob(GetJobRequest.newBuilder().setJobId(jobId).build());
    }
}
