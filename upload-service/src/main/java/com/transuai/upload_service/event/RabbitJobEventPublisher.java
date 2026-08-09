package com.transuai.upload_service.event;

import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.stereotype.Component;

import com.transuai.upload_service.config.MqProperties;

import lombok.RequiredArgsConstructor;

@Component
@RequiredArgsConstructor
public class RabbitJobEventPublisher implements JobEventPublisher {

    private final RabbitTemplate rabbitTemplate;
    private final MqProperties mqProperties;

    @Override
    public void publishTranscriptionRequested(TranscriptionRequestedEvent event) {
        rabbitTemplate.convertAndSend(mqProperties.transcriptionRequestedQueue(), event);
    }
}
