package com.transuai.auth_service.repository;

import org.springframework.data.jpa.repository.JpaRepository;

import com.transuai.auth_service.domain.MailSettings;

public interface MailSettingsRepository extends JpaRepository<MailSettings, Integer> {
}
