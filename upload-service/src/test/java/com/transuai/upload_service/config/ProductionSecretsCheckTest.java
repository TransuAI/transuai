package com.transuai.upload_service.config;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;

/** 正式環境（APP_ENV=production）啟動前檢查密鑰（見 .scratch/pre-launch-hardening/issues/07）。 */
class ProductionSecretsCheckTest {

    @Test
    void theDevelopmentDefaultsAreRefused() {
        MockEnvironment environment = new MockEnvironment()
                .withProperty("spring.datasource.password", "0000")
                .withProperty("spring.rabbitmq.password", "0000")
                .withProperty("app.storage.secret-key", "00000000");

        assertThatThrownBy(() -> new ProductionSecretsCheck(environment))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("DB_PASSWORD")
                .hasMessageContaining("RABBITMQ_PASSWORD")
                .hasMessageContaining("STORAGE_SECRET_KEY");
    }

    @Test
    void aShortSecretIsRefused() {
        MockEnvironment environment = new MockEnvironment()
                .withProperty("spring.datasource.password", "short-1")
                .withProperty("spring.rabbitmq.password", "a-long-real-production-secret-0123456789")
                .withProperty("app.storage.secret-key", "a-long-real-production-secret-0123456789");

        assertThatThrownBy(() -> new ProductionSecretsCheck(environment)).hasMessageContaining("DB_PASSWORD");
    }

    @Test
    void realSecretsPass() {
        MockEnvironment environment = new MockEnvironment()
                .withProperty("spring.datasource.password", "a-long-real-production-secret-0123456789")
                .withProperty("spring.rabbitmq.password", "a-long-real-production-secret-0123456789")
                .withProperty("app.storage.secret-key", "a-long-real-production-secret-0123456789");

        assertThat(new ProductionSecretsCheck(environment)).isNotNull();
    }
}
