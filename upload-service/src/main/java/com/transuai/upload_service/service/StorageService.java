package com.transuai.upload_service.service;

import java.time.Duration;
import java.time.Instant;
import java.util.UUID;

import org.springframework.stereotype.Service;

import com.transuai.upload_service.config.StorageProperties;

import lombok.RequiredArgsConstructor;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.DeleteObjectRequest;
import software.amazon.awssdk.services.s3.model.HeadObjectRequest;
import software.amazon.awssdk.services.s3.model.NoSuchKeyException;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;
import software.amazon.awssdk.services.s3.presigner.model.PresignedPutObjectRequest;
import software.amazon.awssdk.services.s3.presigner.model.PutObjectPresignRequest;

@Service
@RequiredArgsConstructor
public class StorageService {

    private final S3Presigner s3Presigner;
    private final S3Client s3Client;
    private final StorageProperties storageProperties;

    public PresignedUpload createPresignedUploadUrl(String objectKey) {
        PutObjectRequest putObjectRequest = PutObjectRequest.builder()
                .bucket(storageProperties.bucket())
                .key(objectKey)
                .build();

        Duration expiry = Duration.ofMinutes(storageProperties.presignExpiryMinutes());
        PutObjectPresignRequest presignRequest = PutObjectPresignRequest.builder()
                .signatureDuration(expiry)
                .putObjectRequest(putObjectRequest)
                .build();

        PresignedPutObjectRequest presigned = s3Presigner.presignPutObject(presignRequest);
        return new PresignedUpload(presigned.url().toString(), objectKey, Instant.now().plus(expiry));
    }

    public boolean objectExists(String objectKey) {
        try {
            s3Client.headObject(HeadObjectRequest.builder()
                    .bucket(storageProperties.bucket())
                    .key(objectKey)
                    .build());
            return true;
        } catch (NoSuchKeyException e) {
            return false;
        }
    }

    public void deleteObject(String objectKey) {
        s3Client.deleteObject(DeleteObjectRequest.builder()
                .bucket(storageProperties.bucket())
                .key(objectKey)
                .build());
    }

    // 物件 key 在 presign 階段就決定（此時 Job 還不存在），格式：uploads/{userId}/{隨機 id}-{檔名}
    public static String buildObjectKey(UUID userId, String fileName) {
        return "uploads/%s/%s-%s".formatted(userId, UUID.randomUUID(), sanitizeFileName(fileName));
    }

    // 避免檔名帶路徑分隔符號等字元造成物件 key 被跳脫到非預期路徑
    private static String sanitizeFileName(String fileName) {
        String base = fileName == null ? "" : fileName.strip();
        String cleaned = base.replaceAll("[^A-Za-z0-9._-]", "_");
        return cleaned.isBlank() ? "file" : cleaned;
    }

    public record PresignedUpload(String uploadUrl, String objectKey, Instant expiresAt) {
    }
}
