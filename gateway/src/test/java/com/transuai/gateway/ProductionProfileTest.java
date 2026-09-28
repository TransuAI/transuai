package com.transuai.gateway;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.test.web.servlet.MockMvc;

/** APP_ENV=production：API 文件（Swagger UI、OpenAPI）不對外。 */
@SpringBootTest(properties = {
        "APP_ENV=production",
        "JWT_SECRET=a-long-random-production-secret-0123456789",
        "REDIS_PASSWORD=a-redis-password",
})
@AutoConfigureMockMvc
@Import(RedisContainerConfig.class)
class ProductionProfileTest {

    @Autowired
    private MockMvc mvc;

    @Test
    void theApiDocsAreNotServed() throws Exception {
        mvc.perform(get("/v3/api-docs")).andExpect(status().isNotFound());
        mvc.perform(get("/swagger-ui/index.html")).andExpect(status().isNotFound());
    }
}
