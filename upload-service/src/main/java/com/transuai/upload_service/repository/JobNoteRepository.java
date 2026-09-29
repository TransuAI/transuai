package com.transuai.upload_service.repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.transaction.annotation.Transactional;

import com.transuai.upload_service.domain.JobNoteEntity;

public interface JobNoteRepository extends JpaRepository<JobNoteEntity, UUID> {

    List<JobNoteEntity> findByJobId(UUID jobId);

    Optional<JobNoteEntity> findByIdAndJobId(UUID id, UUID jobId);

    long countByJobId(UUID jobId);

    @Transactional
    void deleteByJobId(UUID jobId);
}
