package com.transuai.upload_service.event;

import java.util.UUID;

import org.springframework.amqp.AmqpRejectAndDontRequeueException;
import org.springframework.amqp.core.Message;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.stereotype.Component;

import com.transuai.upload_service.repository.JobRepository;
import com.transuai.upload_service.service.JobDeletion;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * account.deleted（使用者刪除了帳號）：刪掉他所有的 Job——每個都走 {@link JobDeletion}，所以也各自發 job.deleted，transcription-service、
 * ai-service 再清掉自己手上的。可以重複處理（Job 已經刪掉就找不到了）。處理失敗 reject 不 requeue，dead-letter 到 retry 佇列，30 秒後
 * 再來；訊息本身不合法（不是 JSON、沒有合法的 userId）重試也沒用，記 log 後收下。
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class AccountDeletedListener {

    private static final JsonMapper JSON = JsonMapper.builder().build();

    private final JobRepository jobRepository;
    private final JobDeletion jobDeletion;

    @RabbitListener(queues = "${app.mq.account-deleted-queue}")
    public void onAccountDeleted(Message message) {
        UUID userId = userId(message);
        if (userId == null) {
            return;
        }
        try {
            var jobs = jobRepository.findAllByUserId(userId);
            jobs.forEach(jobDeletion::delete);
            log.info("deleted {} jobs of deleted account {}", jobs.size(), userId);
        } catch (RuntimeException e) {
            log.warn("could not delete the jobs of deleted account {}, will retry", userId, e);
            throw new AmqpRejectAndDontRequeueException("retry later", e);
        }
    }

    private static UUID userId(Message message) {
        try {
            JsonNode payload = JSON.readTree(message.getBody());
            return UUID.fromString(payload.get("userId").asString());
        } catch (RuntimeException e) {
            log.error("dropping invalid account.deleted message: {}", e.getMessage());
            return null;
        }
    }
}
