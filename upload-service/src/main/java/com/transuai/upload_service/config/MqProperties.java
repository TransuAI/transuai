package com.transuai.upload_service.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "app.mq")
public record MqProperties(String transcriptionRequestedQueue, String jobDeletedExchange) {
}
