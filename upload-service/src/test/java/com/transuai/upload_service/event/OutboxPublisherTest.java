package com.transuai.upload_service.event;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Duration;
import java.util.List;

import org.junit.jupiter.api.Test;
import org.springframework.amqp.AmqpConnectException;
import org.springframework.amqp.rabbit.core.RabbitTemplate;

import com.transuai.upload_service.domain.OutboxEventEntity;
import com.transuai.upload_service.repository.OutboxEventRepository;

/** outbox：broker 確認收到才刪；送失敗的留著、這一輪停下，下一輪重送。 */
class OutboxPublisherTest {

    private final OutboxEventRepository outbox = mock(OutboxEventRepository.class);
    private final RabbitTemplate rabbitTemplate = mock(RabbitTemplate.class);
    private final OutboxPublisher publisher = new OutboxPublisher(outbox, rabbitTemplate, Duration.ofSeconds(5));

    private final OutboxEventEntity first = event("{\"jobId\":\"1\"}");
    private final OutboxEventEntity second = event("{\"jobId\":\"2\"}");

    @Test
    void sentEventsAreRemoved() {
        when(outbox.findTop100ByOrderByCreatedAtAsc()).thenReturn(List.of(first, second));

        publisher.publishPending();

        verify(rabbitTemplate, times(2)).invoke(any());
        verify(outbox).delete(first);
        verify(outbox).delete(second);
    }

    @Test
    void whenTheBrokerCannotBeReachedNothingIsRemovedAndTheRoundStops() {
        when(outbox.findTop100ByOrderByCreatedAtAsc()).thenReturn(List.of(first, second));
        when(rabbitTemplate.invoke(any())).thenThrow(new AmqpConnectException(new RuntimeException("down")));

        publisher.publishPending();

        verify(rabbitTemplate, times(1)).invoke(any());
        verify(outbox, never()).delete(any());
    }

    private static OutboxEventEntity event(String payload) {
        return OutboxEventEntity.builder().exchange("job.deleted").payload(payload).build();
    }
}
