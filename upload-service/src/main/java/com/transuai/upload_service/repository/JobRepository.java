package com.transuai.upload_service.repository;

import java.util.Optional;
import java.util.UUID;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

import com.transuai.upload_service.domain.JobEntity;

public interface JobRepository extends JpaRepository<JobEntity, UUID> {

    Optional<JobEntity> findByIdAndUserId(UUID id, UUID userId);

    Page<JobEntity> findByUserIdOrderByCreatedAtDesc(UUID userId, Pageable pageable);
}
