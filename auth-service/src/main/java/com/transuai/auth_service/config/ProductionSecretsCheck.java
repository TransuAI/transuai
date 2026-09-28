package com.transuai.auth_service.config;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;

import org.springframework.context.annotation.Profile;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

/**
 * 正式環境（{@code APP_ENV=production}，也就是 production profile）啟動前檢查密鑰：沒設、還是 application.properties 裡的開發用預設值、
 * 或太短，就拒絕啟動並說出是哪幾個環境變數——少設一個不能默默用開發值跑起來。開發環境不檢查。gateway、auth-service、upload-service
 * 各有一份（各自的 repo），檢查的密鑰不同。
 */
@Component
@Profile("production")
public class ProductionSecretsCheck {

    /** 各服務設定裡的開發用預設值（跟 infra/k8s/02-secret.yaml 一致）。 */
    private static final Set<String> DEVELOPMENT_DEFAULTS = Set.of(
            "", "0000", "00000000", "admin", "dev-only-shared-secret-change-me-before-any-real-deployment");
    private static final int MIN_LENGTH = 12;
    // HS256 的密鑰至少要 256 bits。
    private static final int MIN_JWT_SECRET_LENGTH = 32;

    public ProductionSecretsCheck(Environment environment) {
        List<String> problems = new ArrayList<>();
        check(environment, "app.jwt.secret", "JWT_SECRET", MIN_JWT_SECRET_LENGTH, problems);
        check(environment, "spring.datasource.password", "DB_PASSWORD", MIN_LENGTH, problems);
        if (!problems.isEmpty()) {
            throw new IllegalStateException("APP_ENV=production needs real secrets: " + String.join("; ", problems));
        }
    }

    private static void check(Environment environment, String property, String variable, int minLength,
            List<String> problems) {
        String value = environment.getProperty(property, "");
        if (DEVELOPMENT_DEFAULTS.contains(value)) {
            problems.add(variable + " is not set (or is the development default)");
        } else if (value.length() < minLength) {
            problems.add(variable + " must be at least " + minLength + " characters");
        }
    }
}
