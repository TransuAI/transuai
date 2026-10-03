package com.transuai.upload_service.config;

import org.springframework.amqp.core.ExchangeBuilder;
import org.springframework.amqp.core.FanoutExchange;
import org.springframework.amqp.core.Queue;
import org.springframework.amqp.core.QueueBuilder;
import org.springframework.amqp.rabbit.connection.ConnectionFactory;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.amqp.support.converter.JacksonJsonMessageConverter;
import org.springframework.amqp.support.converter.MessageConverter;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class RabbitConfig {

    @Bean
    public Queue transcriptionRequestedQueue(MqProperties mqProperties) {
        return QueueBuilder.durable(mqProperties.transcriptionRequestedQueue()).build();
    }

    // job.deleted 要送給好幾個服務（transcription-service、ai-service 各自綁自己的佇列），所以是 fanout exchange。
    @Bean
    public FanoutExchange jobDeletedExchange(MqProperties mqProperties) {
        return ExchangeBuilder.fanoutExchange(mqProperties.jobDeletedExchange()).durable(true).build();
    }

    @Bean
    public MessageConverter jsonMessageConverter() {
        return new JacksonJsonMessageConverter();
    }

    @Bean
    public RabbitTemplate rabbitTemplate(ConnectionFactory connectionFactory, MessageConverter jsonMessageConverter) {
        RabbitTemplate template = new RabbitTemplate(connectionFactory);
        template.setMessageConverter(jsonMessageConverter);
        return template;
    }
}
