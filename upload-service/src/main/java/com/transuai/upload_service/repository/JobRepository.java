package com.transuai.upload_service.repository;

import java.util.Optional;
import java.util.UUID;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;

import com.transuai.upload_service.domain.Job;

public interface JobRepository extends JpaRepository<Job, UUID> {

    Optional<Job> findByIdAndUserId(UUID id, UUID userId);

    Page<Job> findByUserIdOrderByCreatedAtDesc(UUID userId, Pageable pageable);
}
