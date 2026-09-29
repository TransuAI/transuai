package com.transuai.gateway.web;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;

import com.transuai.gateway.RedisContainerConfig;
import com.transuai.gateway.TestAuth;
import com.transuai.gateway.security.JwtProperties;
import com.transuai.upload.grpc.v1.Job;
import com.transuai.upload.grpc.v1.ListJobsResponse;
import com.transuai.upload.grpc.v1.UploadServiceGrpc;

/** 標題與類型（見 .scratch/job-auto-title）：Job 的回應帶出 upload-service 的標題與類型；沒有的是 null。 */
@SpringBootTest
@AutoConfigureMockMvc
@Import(RedisContainerConfig.class)
class JobTitleTest {

    private static final String JOB = "11111111-1111-1111-1111-111111111111";

    @Autowired
    private MockMvc mvc;

    @Autowired
    private StringRedisTemplate redis;

    @Autowired
    private JwtProperties jwt;

    @MockitoBean
    private UploadServiceGrpc.UploadServiceBlockingStub uploadServiceStub;

    private final UUID user = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        redis.getConnectionFactory().getConnection().serverCommands().flushAll();
        when(uploadServiceStub.withInterceptors(any())).thenReturn(uploadServiceStub);
    }

    @Test
    void aJobComesWithItsTitleAndCategory() throws Exception {
        when(uploadServiceStub.getJob(any())).thenReturn(Job.newBuilder().setJobId(JOB).setFileName("REC_0012.m4a")
                .setTitle("產品週會：上傳失敗與轉錄重試").setCategory("meeting").build());

        get("/jobs/" + JOB)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.title").value("產品週會：上傳失敗與轉錄重試"))
                .andExpect(jsonPath("$.category").value("meeting"))
                .andExpect(jsonPath("$.fileName").value("REC_0012.m4a"));
    }

    @Test
    void aJobWithoutATitleOrCategoryHasNullForThem() throws Exception {
        when(uploadServiceStub.listJobs(any())).thenReturn(ListJobsResponse.newBuilder()
                .addJobs(Job.newBuilder().setJobId(JOB).setFileName("REC_0012.m4a")).setTotalCount(1).build());

        get("/jobs")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.jobs[0].title").isEmpty())
                .andExpect(jsonPath("$.jobs[0].category").isEmpty());
    }

    private ResultActions get(String path) throws Exception {
        return mvc.perform(MockMvcRequestBuilders.get(path)
                .header("Authorization", "Bearer " + TestAuth.accessToken(jwt, user)));
    }
}
