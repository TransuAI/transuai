package com.transuai.auth_service.repository;

import java.time.OffsetDateTime;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import com.transuai.auth_service.domain.PasswordResetToken;

import jakarta.persistence.LockModeType;

public interface PasswordResetTokenRepository extends JpaRepository<PasswordResetToken, UUID> {

    /** 鎖住那一列：同一個連結同時送兩次，只有一次用得掉。 */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select t from PasswordResetToken t where t.tokenHash = :tokenHash")
    Optional<PasswordResetToken> findForUpdate(@Param("tokenHash") String tokenHash);

    /** 這位使用者還能用的全部作廢（申請新的、重設成功時）。 */
    @Modifying
    @Query("update PasswordResetToken t set t.usedAt = :now where t.userId = :userId and t.usedAt is null")
    int useUpAllOf(@Param("userId") UUID userId, @Param("now") OffsetDateTime now);

    @Modifying
    @Query("delete from PasswordResetToken t where t.userId = :userId")
    int deleteByUserId(@Param("userId") UUID userId);
}
