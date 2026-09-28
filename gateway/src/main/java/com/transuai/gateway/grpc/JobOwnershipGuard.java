package com.transuai.gateway.grpc;

import java.util.Optional;
import java.util.UUID;

import org.springframework.stereotype.Component;

import com.transuai.gateway.cache.JobOwnerCache;
import com.transuai.upload.grpc.v1.GetJobRequest;
import com.transuai.upload.grpc.v1.Job;
import com.transuai.upload.grpc.v1.UploadServiceGrpc;

import io.grpc.Status;
import lombok.RequiredArgsConstructor;

/**
 * transcription-service 的 GetTranscript、ai-service 的 GetSummary/ListChapters 本身不驗證
 * x-user-id（見對應 proto 的註解，只信任內部網路呼叫），呼叫前得先自己確認這個 job 是不是目前使用者的。
 * 直接借用 upload-service 的 GetJob——它本身就有 ownership 檢查，別人的 job 回 NOT_FOUND
 * （見 UploadController），不用在這裡重新實作一次比對邏輯。查不到就讓例外原樣往外冒，
 * GrpcExceptionAdvice 會轉成 404，呼叫端就不會再往下打到 transcription-service/ai-service。
 * 查到的擁有者記在 {@link JobOwnerCache}（cache-aside），前端每幾秒輪詢一次時不用每次都問 upload-service。
 */
@Component
@RequiredArgsConstructor
public class JobOwnershipGuard {

    private final UploadServiceGrpc.UploadServiceBlockingStub uploadServiceStub;
    private final JobOwnerCache ownerCache;

    public void check(UUID userId, String jobId) {
        Optional<UUID> owner = ownerCache.owner(jobId);
        if (owner.isEmpty()) {
            fetch(userId, jobId);
        } else if (!owner.get().equals(userId)) {
            // 跟 upload-service 對別人的 job 回的一樣：不透露這個 job 存在。
            throw Status.NOT_FOUND.withDescription("job not found").asRuntimeException();
        }
    }

    // 同樣的檢查，順便把 Job 本身交給需要它的呼叫端（例如會後處理要知道上傳時間）；一定問 upload-service（要最新的 Job）。
    public Job fetch(UUID userId, String jobId) {
        Job job = GrpcMetadataSupport.withUserId(uploadServiceStub, userId)
                .getJob(GetJobRequest.newBuilder().setJobId(jobId).build());
        ownerCache.remember(jobId, userId);
        return job;
    }
}
