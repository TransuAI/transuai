package com.transuai.upload_service.service;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import java.util.regex.Pattern;

import org.springframework.stereotype.Service;

import com.transuai.upload_service.config.StorageProperties;

import lombok.RequiredArgsConstructor;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.DeleteObjectRequest;
import software.amazon.awssdk.services.s3.model.HeadObjectRequest;
import software.amazon.awssdk.services.s3.model.HeadObjectResponse;
import software.amazon.awssdk.services.s3.model.NoSuchKeyException;
import software.amazon.awssdk.services.s3.model.GetObjectRequest;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;
import software.amazon.awssdk.services.s3.presigner.S3Presigner;
import software.amazon.awssdk.services.s3.presigner.model.GetObjectPresignRequest;
import software.amazon.awssdk.services.s3.presigner.model.PresignedGetObjectRequest;
import software.amazon.awssdk.services.s3.presigner.model.PresignedPutObjectRequest;
import software.amazon.awssdk.services.s3.presigner.model.PutObjectPresignRequest;

@Service
@RequiredArgsConstructor
public class StorageService {

    private static final Pattern MEDIA_TYPE = Pattern.compile("(audio|video)/[a-z0-9][a-z0-9.+-]*", Pattern.CASE_INSENSITIVE);

    private final S3Presigner s3Presigner;
    private final S3Client s3Client;
    private final StorageProperties storageProperties;

    // contentType 簽進 URL：上傳時的 Content-Type 必須跟它一樣，存下來的物件類型就是驗證過的這個（有效期間內重新 PUT 也一樣）。
    public PresignedUpload createPresignedUploadUrl(String objectKey, String contentType) {
        PutObjectRequest putObjectRequest = PutObjectRequest.builder()
                .bucket(storageProperties.bucket())
                .key(objectKey)
                .contentType(contentType)
                .build();

        Duration expiry = Duration.ofMinutes(storageProperties.presignExpiryMinutes());
        PutObjectPresignRequest presignRequest = PutObjectPresignRequest.builder()
                .signatureDuration(expiry)
                .putObjectRequest(putObjectRequest)
                .build();

        PresignedPutObjectRequest presigned = s3Presigner.presignPutObject(presignRequest);
        return new PresignedUpload(presigned.url().toString(), objectKey, Instant.now().plus(expiry));
    }

    // 給播放器 inline 讀取的 URL。存下來的類型不是音訊或影片（簽 Content-Type 之前上傳的舊物件）時，要物件儲存回
    // application/octet-stream：瀏覽器直接打開也不會當成網頁執行（ASVS 12.5.2），播放器照樣認得音訊與影片的內容。
    public PresignedDownload createPresignedDownloadUrl(String objectKey) {
        GetObjectRequest.Builder request = GetObjectRequest.builder()
                .bucket(storageProperties.bucket())
                .key(objectKey);
        if (!isMediaType(headObjectContentType(objectKey))) {
            request.responseContentType("application/octet-stream");
        }
        return presignGet(request.build());
    }

    /** 上傳的檔案可以是的類型：audio/* 或 video/*（不帶參數）。 */
    public static boolean isMediaType(String contentType) {
        return contentType != null && MEDIA_TYPE.matcher(contentType).matches();
    }

    private String headObjectContentType(String objectKey) {
        try {
            return s3Client.headObject(HeadObjectRequest.builder()
                    .bucket(storageProperties.bucket())
                    .key(objectKey)
                    .build()).contentType();
        } catch (NoSuchKeyException e) {
            return null;
        }
    }

    // 要求物件儲存以 Content-Disposition: attachment 回應的 URL：瀏覽器直接下載、存成 fileName。
    public PresignedDownload createPresignedAttachmentUrl(String objectKey, String fileName) {
        return presignGet(GetObjectRequest.builder()
                .bucket(storageProperties.bucket())
                .key(objectKey)
                .responseContentDisposition(attachmentContentDisposition(fileName))
                .build());
    }

    private PresignedDownload presignGet(GetObjectRequest getObjectRequest) {
        Duration expiry = Duration.ofMinutes(storageProperties.presignDownloadExpiryMinutes());
        GetObjectPresignRequest presignRequest = GetObjectPresignRequest.builder()
                .signatureDuration(expiry)
                .getObjectRequest(getObjectRequest)
                .build();

        PresignedGetObjectRequest presigned = s3Presigner.presignGetObject(presignRequest);
        return new PresignedDownload(presigned.url().toString(), Instant.now().plus(expiry));
    }

    // RFC 6266：ASCII 備援檔名（非 ASCII、引號、反斜線換成 _）＋ RFC 5987 的 UTF-8 檔名（percent-encoded），
    // 讓中文檔名在現代瀏覽器正確顯示，老舊 client 也至少拿到一個合法的檔名。
    private static String attachmentContentDisposition(String fileName) {
        StringBuilder asciiFallback = new StringBuilder();
        fileName.codePoints().forEach(cp -> asciiFallback.append(
                cp >= 0x20 && cp < 0x7f && cp != '"' && cp != '\\' ? Character.toString(cp) : "_"));

        StringBuilder encoded = new StringBuilder();
        for (byte b : fileName.getBytes(StandardCharsets.UTF_8)) {
            int c = b & 0xff;
            boolean attrChar = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')
                    || "!#$&+-.^_`|~".indexOf(c) >= 0;
            encoded.append(attrChar ? Character.toString(c) : String.format("%%%02X", c));
        }
        return "attachment; filename=\"" + asciiFallback + "\"; filename*=UTF-8''" + encoded;
    }

    // completeUpload() 不能只信任呼叫端回報的 file_size_bytes——那個數字完全由 client 決定，
    // 拿它來做大小限制形同沒有限制。這裡直接問物件儲存實際存了多大，回傳 Optional.empty() 代表
    // 物件還不存在（呼叫端可能在上傳完成前就呼叫了 completeUpload）。
    public Optional<Long> headObjectSize(String objectKey) {
        try {
            HeadObjectResponse response = s3Client.headObject(HeadObjectRequest.builder()
                    .bucket(storageProperties.bucket())
                    .key(objectKey)
                    .build());
            return Optional.of(response.contentLength());
        } catch (NoSuchKeyException e) {
            return Optional.empty();
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

    public record PresignedDownload(String downloadUrl, Instant expiresAt) {
    }
}
