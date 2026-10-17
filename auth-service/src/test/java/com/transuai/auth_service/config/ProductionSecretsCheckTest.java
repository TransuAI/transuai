package com.transuai.auth_service.config;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;

/** 正式環境（APP_ENV=production）啟動前檢查密鑰（見 .scratch/pre-launch-hardening/issues/07）。 */
class ProductionSecretsCheckTest {

    @Test
    void theDevelopmentDefaultsAreRefused() {
        MockEnvironment environment = new MockEnvironment()
                .withProperty("app.jwt.secret", "dev-only-shared-secret-change-me-before-any-real-deployment")
                .withProperty("spring.datasource.password", "0000")
                .withProperty("spring.rabbitmq.password", "0000");

        assertThatThrownBy(() -> new ProductionSecretsCheck(environment))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("JWT_SECRET")
                .hasMessageContaining("DB_PASSWORD")
                .hasMessageContaining("RABBITMQ_PASSWORD");
    }

    @Test
    void aShortSecretIsRefused() {
        MockEnvironment environment = new MockEnvironment()
                .withProperty("app.jwt.secret", "short-1")
                .withProperty("spring.datasource.password", "a-long-real-production-secret-0123456789")
                .withProperty("spring.rabbitmq.password", "a-long-real-production-secret-0123456789");

        assertThatThrownBy(() -> new ProductionSecretsCheck(environment)).hasMessageContaining("JWT_SECRET");
    }

    @Test
    void realSecretsPass() {
        MockEnvironment environment = new MockEnvironment()
                .withProperty("app.jwt.secret", "a-long-real-production-secret-0123456789")
                .withProperty("spring.datasource.password", "a-long-real-production-secret-0123456789")
                .withProperty("spring.rabbitmq.password", "a-long-real-production-secret-0123456789");

        assertThat(new ProductionSecretsCheck(environment)).isNotNull();
    }
}
