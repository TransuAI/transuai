package com.transuai.auth_service.repository;

import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import com.transuai.auth_service.domain.RecoveryCode;

import jakarta.persistence.LockModeType;

public interface RecoveryCodeRepository extends JpaRepository<RecoveryCode, UUID> {

    /** 鎖住那一列：同一組復原碼同時送兩次，只有一次用得掉。 */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select c from RecoveryCode c where c.userId = :userId and c.codeHash = :codeHash and c.usedAt is null")
    Optional<RecoveryCode> findUnusedForUpdate(@Param("userId") UUID userId, @Param("codeHash") String codeHash);

    @Query("select count(c) from RecoveryCode c where c.userId = :userId and c.usedAt is null")
    long countUnused(@Param("userId") UUID userId);

    @Modifying
    @Query("delete from RecoveryCode c where c.userId = :userId")
    int deleteByUserId(@Param("userId") UUID userId);
}
