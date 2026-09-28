package com.transuai.gateway;

import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.annotation.Bean;
import org.testcontainers.containers.GenericContainer;

/**
 * 測試用的 Redis：Testcontainers 起一個用完即丟的容器（要有 Docker），Spring Boot 的 {@code @ServiceConnection}
 * 自動把連線設定指過去。
 */
@TestConfiguration(proxyBeanMethods = false)
public class RedisContainerConfig {

    @Bean
    @ServiceConnection(name = "redis")
    GenericContainer<?> redis() {
        return new GenericContainer<>("redis:7-alpine").withExposedPorts(6379);
    }
}
