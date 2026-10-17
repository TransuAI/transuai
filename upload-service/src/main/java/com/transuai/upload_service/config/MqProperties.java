package com.transuai.upload_service.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "app.mq")
// accountDeleted*：刪除帳號的事件（auth-service 的 fanout exchange）、這個服務自己的佇列、處理失敗時等一下再回來的 retry 佇列。
public record MqProperties(String transcriptionRequestedQueue, String jobDeletedExchange, String accountDeletedExchange,
        String accountDeletedQueue, String accountDeletedRetryQueue, int deletionRetryDelayMs) {
}
