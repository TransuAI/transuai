package com.transuai.auth_service.event;

import java.nio.charset.StandardCharsets;
import java.time.Duration;

import org.springframework.amqp.core.Message;
import org.springframework.amqp.core.MessageProperties;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import com.transuai.auth_service.domain.OutboxEventEntity;
import com.transuai.auth_service.repository.OutboxEventRepository;

import lombok.extern.slf4j.Slf4j;

/**
 * 把 outbox 裡的事件送到 RabbitMQ：每一筆等 broker 確認收到（publisher confirm）才刪掉；送失敗就停在這一筆，下一輪從它重來
 *（順序不重要，但不用一直撞一個連不上的 broker）。所以每個事件至少送出一次、可能不只一次。
 */
@Component
@Slf4j
public class OutboxPublisher {

    private final OutboxEventRepository outbox;
    private final RabbitTemplate rabbitTemplate;
    private final Duration confirmTimeout;

    public OutboxPublisher(OutboxEventRepository outbox, RabbitTemplate rabbitTemplate,
            @Value("${app.outbox.confirm-timeout}") Duration confirmTimeout) {
        this.outbox = outbox;
        this.rabbitTemplate = rabbitTemplate;
        this.confirmTimeout = confirmTimeout;
    }

    @Scheduled(fixedDelayString = "${app.outbox.poll-interval}")
    public void publishPending() {
        for (OutboxEventEntity event : outbox.findTop100ByOrderByCreatedAtAsc()) {
            try {
                send(event);
            } catch (RuntimeException e) {
                log.warn("could not publish outbox event {} to {}, will retry", event.getId(), event.getExchange(), e);
                return;
            }
            outbox.delete(event);
        }
    }

    private void send(OutboxEventEntity event) {
        MessageProperties properties = new MessageProperties();
        properties.setContentType(MessageProperties.CONTENT_TYPE_JSON);
        properties.setContentEncoding(StandardCharsets.UTF_8.name());
        Message message = new Message(event.getPayload().getBytes(StandardCharsets.UTF_8), properties);
        rabbitTemplate.invoke(operations -> {
            operations.send(event.getExchange(), "", message);
            operations.waitForConfirmsOrDie(confirmTimeout.toMillis());
            return null;
        });
    }
}
