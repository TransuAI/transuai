package com.transuai.gateway.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "app.grpc")
public record GrpcProperties(
        String authServiceTarget,
        String uploadServiceTarget,
        String transcriptionServiceTarget,
        String aiServiceTarget) {
}
