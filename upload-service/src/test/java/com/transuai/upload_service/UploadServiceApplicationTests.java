package com.transuai.upload_service;

import org.springframework.context.annotation.Import;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;

@Import(InfraContainersConfig.class)
@SpringBootTest
class UploadServiceApplicationTests {

	@Test
	void contextLoads() {
	}

}
