package com.transuai.gateway.config;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;

/** 正式環境（APP_ENV=production）啟動前檢查密鑰：沒設、還是開發用的預設值、或太短就不啟動（見 .scratch/pre-launch-hardening/issues/07）。 */
class ProductionSecretsCheckTest {

    private static final String GOOD_JWT_SECRET = "a-long-random-production-secret-0123456789";

    @Test
    void theDevelopmentDefaultsAreRefused() {
        MockEnvironment environment = new MockEnvironment()
                .withProperty("app.jwt.secret", "dev-only-shared-secret-change-me-before-any-real-deployment")
                .withProperty("spring.data.redis.password", "");

        assertThatThrownBy(() -> new ProductionSecretsCheck(environment))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("JWT_SECRET")
                .hasMessageContaining("REDIS_PASSWORD");
    }

    @Test
    void aShortJwtSecretIsRefused() {
        MockEnvironment environment = new MockEnvironment()
                .withProperty("app.jwt.secret", "short-secret-1234")
                .withProperty("spring.data.redis.password", "a-redis-password");

        assertThatThrownBy(() -> new ProductionSecretsCheck(environment)).hasMessageContaining("JWT_SECRET");
    }

    @Test
    void realSecretsPass() {
        MockEnvironment environment = new MockEnvironment()
                .withProperty("app.jwt.secret", GOOD_JWT_SECRET)
                .withProperty("spring.data.redis.password", "a-redis-password");

        assertThat(new ProductionSecretsCheck(environment)).isNotNull();
    }
}
