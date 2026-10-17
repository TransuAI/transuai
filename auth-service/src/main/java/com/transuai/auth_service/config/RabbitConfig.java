package com.transuai.auth_service.config;

import org.springframework.amqp.core.ExchangeBuilder;
import org.springframework.amqp.core.FanoutExchange;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class RabbitConfig {

    // account.deleted 要送給好幾個服務（各自綁自己的佇列），所以是 fanout exchange（見 docs/adr/0005）。
    @Bean
    public FanoutExchange accountDeletedExchange(@Value("${app.mq.account-deleted-exchange}") String name) {
        return ExchangeBuilder.fanoutExchange(name).durable(true).build();
    }
}
