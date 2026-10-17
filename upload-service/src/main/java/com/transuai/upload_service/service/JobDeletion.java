package com.transuai.upload_service.service;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.transuai.upload_service.config.MqProperties;
import com.transuai.upload_service.domain.JobEntity;
import com.transuai.upload_service.domain.OutboxEventEntity;
import com.transuai.upload_service.event.JobDeletedEvent;
import com.transuai.upload_service.repository.JobNoteRepository;
import com.transuai.upload_service.repository.JobRepository;
import com.transuai.upload_service.repository.OutboxEventRepository;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import tools.jackson.databind.json.JsonMapper;

/**
 * 刪除一個 Job：物件儲存的檔案、筆記、Job，並發 job.deleted（outbox，跟刪除同一個交易）讓 transcription-service、ai-service
 * 清掉自己手上的資料。使用者刪 Job（DeleteJob）與刪帳號都走這裡。
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class JobDeletion {

    private static final JsonMapper JSON = JsonMapper.builder().build();

    private final StorageService storageService;
    private final JobRepository jobRepository;
    private final JobNoteRepository noteRepository;
    private final OutboxEventRepository outbox;
    private final MqProperties mqProperties;

    @Transactional
    public void delete(JobEntity job) {
        // 物件儲存刪除失敗只記警告、不擋刪除：使用者的刪除意圖優先，孤兒物件之後可靠背景清理排除。
        try {
            storageService.deleteObject(job.getStoragePath());
        } catch (RuntimeException e) {
            log.warn("failed to delete storage object {} for job {}", job.getStoragePath(), job.getId(), e);
        }
        noteRepository.deleteByJobId(job.getId());  // 筆記屬於 Job，一起刪
        jobRepository.delete(job);
        outbox.save(OutboxEventEntity.builder()
                .exchange(mqProperties.jobDeletedExchange())
                .payload(JSON.writeValueAsString(new JobDeletedEvent(job.getId().toString(), job.getUserId().toString())))
                .build());
    }
}
