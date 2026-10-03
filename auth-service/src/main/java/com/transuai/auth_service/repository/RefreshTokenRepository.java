package com.transuai.auth_service.repository;

import java.time.OffsetDateTime;
import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import com.transuai.auth_service.domain.RefreshToken;

import jakarta.persistence.LockModeType;

public interface RefreshTokenRepository extends JpaRepository<RefreshToken, UUID> {

    /** 換發時鎖住這一列：同一個 token 同時換發兩次，第二次看得到第一次的結果。 */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select t from RefreshToken t where t.id = :id")
    Optional<RefreshToken> findForUpdate(@Param("id") UUID id);

    /** 整串作廢（包括已經換發過的：寬限內也不能再換）。 */
    @Modifying
    @Query("update RefreshToken t set t.revokedAt = :now, t.revokedReason = :reason where t.familyId = :familyId")
    int revokeFamily(@Param("familyId") UUID familyId, @Param("reason") RefreshToken.RevokedReason reason,
            @Param("now") OffsetDateTime now);

    /** 這位使用者的全部作廢（登出所有裝置）。 */
    @Modifying
    @Query("delete from RefreshToken t where t.userId = :userId")
    int deleteByUserId(@Param("userId") UUID userId);

    @Modifying
    @Query("update RefreshToken t set t.revokedAt = :now, t.revokedReason = :reason where t.userId = :userId")
    int revokeAllOf(@Param("userId") UUID userId, @Param("reason") RefreshToken.RevokedReason reason,
            @Param("now") OffsetDateTime now);
}
