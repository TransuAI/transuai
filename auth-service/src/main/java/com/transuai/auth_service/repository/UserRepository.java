package com.transuai.auth_service.repository;

import java.util.Optional;
import java.util.UUID;

import org.springframework.data.jpa.repository.JpaRepository;

import com.transuai.auth_service.domain.User;

public interface UserRepository extends JpaRepository<User, UUID> {

    Optional<User> findByEmail(String email);

    boolean existsByEmail(String email);

    /**
     * 註冊時鎖住「誰是第一個帳號」的判斷，同時註冊的兩個人只有一個是管理員（交易結束自動放開）。
     */
    @org.springframework.data.jpa.repository.Query(
            value = "SELECT 1 FROM (SELECT pg_advisory_xact_lock(820261018)) AS locked", nativeQuery = true)
    Integer lockForFirstAccount();
}
