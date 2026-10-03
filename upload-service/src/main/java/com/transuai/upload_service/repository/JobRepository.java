package com.transuai.upload_service.repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import com.transuai.upload_service.domain.JobEntity;

public interface JobRepository extends JpaRepository<JobEntity, UUID> {

    Optional<JobEntity> findByIdAndUserId(UUID id, UUID userId);

    List<JobEntity> findAllByUserId(UUID userId);

    /**
     * 使用者的 Job 列表（新的在前）。category 為 null 不篩；pattern 是已經轉小寫、跳脫過 {@code \ % _} 的 LIKE 樣式
     * （null 不篩），比對標題或檔名。
     */
    @Query("""
            select j from JobEntity j
            where j.userId = :userId
              and (:category is null or j.category = :category)
              and (:pattern is null
                   or lower(j.title) like :pattern escape '\\'
                   or lower(j.fileName) like :pattern escape '\\')
            order by j.createdAt desc
            """)
    Page<JobEntity> search(@Param("userId") UUID userId, @Param("category") String category,
            @Param("pattern") String pattern, Pageable pageable);
}
