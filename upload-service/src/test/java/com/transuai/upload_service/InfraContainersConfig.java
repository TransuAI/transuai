package com.transuai.upload_service;

import java.io.IOException;
import java.io.UncheckedIOException;

import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.annotation.Bean;
import org.springframework.test.context.DynamicPropertyRegistrar;
import org.testcontainers.containers.MinIOContainer;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.rabbitmq.RabbitMQContainer;
import org.testcontainers.utility.DockerImageName;

/**
 * 整合測試用的基礎設施：Testcontainers 起用完即丟的 Postgres、RabbitMQ、MinIO（要有 Docker；CI 的 runner 有），不需要先開本機的 infra。
 * Postgres 與 RabbitMQ 由 {@code @ServiceConnection} 接上；MinIO 沒有對應的自動設定，把 {@code app.storage.*} 指過去，並建好 bucket
 *（正式環境由 minio-init 建）。
 */
@TestConfiguration(proxyBeanMethods = false)
public class InfraContainersConfig {

    private static final String BUCKET = "media-uploads";

    @Bean
    @ServiceConnection
    PostgreSQLContainer postgres() {
        return new PostgreSQLContainer("postgres:16-alpine");
    }

    @Bean
    @ServiceConnection
    RabbitMQContainer rabbitmq() {
        return new RabbitMQContainer("rabbitmq:3-alpine");
    }

    // MinIO 官方的 image 已經從 Docker Hub 下架：跟 infra/deploy 一樣用 Pigsty 維護的同一套程式。
    @Bean
    MinIOContainer minio() {
        return new MinIOContainer(DockerImageName.parse("pgsty/minio:RELEASE.2026-08-04T00-00-00Z")
                .asCompatibleSubstituteFor("minio/minio"));
    }

    @Bean
    DynamicPropertyRegistrar storageProperties(MinIOContainer minio) {
        return registry -> {
            registry.add("app.storage.endpoint", minio::getS3URL);
            registry.add("app.storage.access-key", minio::getUserName);
            registry.add("app.storage.secret-key", minio::getPassword);
            registry.add("app.storage.bucket", () -> createBucket(minio));
        };
    }

    private static String createBucket(MinIOContainer minio) {
        String host = "http://" + minio.getUserName() + ":" + minio.getPassword() + "@localhost:9000";
        try {
            var result = minio.execInContainer("sh", "-c", "MC_HOST_local=" + host + " mc mb --ignore-existing local/" + BUCKET);
            if (result.getExitCode() != 0) {
                throw new IllegalStateException("could not create the test bucket: " + result.getStderr());
            }
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(e);
        }
        return BUCKET;
    }
}
