package com.transuai.upload_service.config;

import org.springframework.amqp.core.Binding;
import org.springframework.amqp.core.BindingBuilder;
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

    // account.deleted（auth-service 發的 fanout exchange）綁一個這個服務自己的佇列。處理失敗就 reject 不 requeue → dead-letter 到 retry
    // 佇列，等 deletionRetryDelayMs 再回來，不限次數（刪除一定要做完，見 docs/adr/0005）。
    @Bean
    public FanoutExchange accountDeletedExchange(MqProperties mqProperties) {
        return ExchangeBuilder.fanoutExchange(mqProperties.accountDeletedExchange()).durable(true).build();
    }

    @Bean
    public Queue accountDeletedQueue(MqProperties mqProperties) {
        return QueueBuilder.durable(mqProperties.accountDeletedQueue())
                .deadLetterExchange("").deadLetterRoutingKey(mqProperties.accountDeletedRetryQueue()).build();
    }

    @Bean
    public Queue accountDeletedRetryQueue(MqProperties mqProperties) {
        return QueueBuilder.durable(mqProperties.accountDeletedRetryQueue()).ttl(mqProperties.deletionRetryDelayMs())
                .deadLetterExchange("").deadLetterRoutingKey(mqProperties.accountDeletedQueue()).build();
    }

    @Bean
    public Binding accountDeletedBinding(Queue accountDeletedQueue, FanoutExchange accountDeletedExchange) {
        return BindingBuilder.bind(accountDeletedQueue).to(accountDeletedExchange);
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
