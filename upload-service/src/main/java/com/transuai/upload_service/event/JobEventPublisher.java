package com.transuai.upload_service.event;

// 抽象化 MQ producer，未來若要從 RabbitMQ 換掉，只需換一個實作。
public interface JobEventPublisher {

    void publishTranscriptionRequested(TranscriptionRequestedEvent event);
}
