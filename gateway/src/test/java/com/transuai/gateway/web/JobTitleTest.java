package com.transuai.gateway.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Import;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;

import com.transuai.gateway.RedisContainerConfig;
import com.transuai.gateway.TestAuth;
import com.transuai.gateway.security.JwtProperties;
import com.transuai.upload.grpc.v1.Job;
import com.transuai.upload.grpc.v1.ListJobsRequest;
import com.transuai.upload.grpc.v1.ListJobsResponse;
import com.transuai.upload.grpc.v1.UpdateJobRequest;
import com.transuai.upload.grpc.v1.UploadServiceGrpc;

import io.grpc.Status;

/** 標題與類型（見 .scratch/job-auto-title）：Job 的回應帶出 upload-service 的標題與類型（沒有的是 null）；使用者可以改。 */
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

    @Test
    void theListIsSearchedAndFilteredByUploadService() throws Exception {
        when(uploadServiceStub.listJobs(any())).thenReturn(ListJobsResponse.newBuilder().setTotalCount(0).build());

        get("/jobs?page=2&pageSize=10&query=週會&category=lecture").andExpect(status().isOk());

        ArgumentCaptor<ListJobsRequest> sent = ArgumentCaptor.forClass(ListJobsRequest.class);
        verify(uploadServiceStub).listJobs(sent.capture());
        assertThat(sent.getValue().getQuery()).isEqualTo("週會");
        assertThat(sent.getValue().getCategory()).isEqualTo("lecture");
        assertThat(sent.getValue().getPage()).isEqualTo(2);
    }

    @Test
    void anUnknownCategoryFilterIsABadRequest() throws Exception {
        when(uploadServiceStub.listJobs(any())).thenThrow(Status.INVALID_ARGUMENT.withDescription("unknown category").asRuntimeException());

        get("/jobs?category=party").andExpect(status().isBadRequest());
    }

    @Test
    void theUserChangesTheTitleAndCategory() throws Exception {
        when(uploadServiceStub.updateJob(any())).thenReturn(Job.newBuilder().setJobId(JOB).setFileName("REC_0012.m4a")
                .setTitle("產品週會").setCategory("meeting").build());

        patch("{\"title\":\"產品週會\",\"category\":\"meeting\"}")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.title").value("產品週會"))
                .andExpect(jsonPath("$.category").value("meeting"));

        ArgumentCaptor<UpdateJobRequest> sent = ArgumentCaptor.forClass(UpdateJobRequest.class);
        verify(uploadServiceStub).updateJob(sent.capture());
        assertThat(sent.getValue().getJobId()).isEqualTo(JOB);
        assertThat(sent.getValue().getTitle()).isEqualTo("產品週會");
        assertThat(sent.getValue().getCategory()).isEqualTo("meeting");
    }

    @Test
    void aFieldLeftOutIsLeftAlone_andAnEmptyTitleClearsIt() throws Exception {
        when(uploadServiceStub.updateJob(any())).thenReturn(Job.newBuilder().setJobId(JOB).setFileName("REC_0012.m4a").build());

        patch("{\"title\":\"\"}").andExpect(status().isOk()).andExpect(jsonPath("$.title").isEmpty());

        ArgumentCaptor<UpdateJobRequest> sent = ArgumentCaptor.forClass(UpdateJobRequest.class);
        verify(uploadServiceStub).updateJob(sent.capture());
        assertThat(sent.getValue().hasTitle()).isTrue();
        assertThat(sent.getValue().getTitle()).isEmpty();
        assertThat(sent.getValue().hasCategory()).isFalse();
    }

    @Test
    void anUnknownCategoryIsABadRequest() throws Exception {
        when(uploadServiceStub.updateJob(any())).thenThrow(Status.INVALID_ARGUMENT.withDescription("unknown category").asRuntimeException());

        patch("{\"category\":\"party\"}").andExpect(status().isBadRequest());
    }

    private ResultActions patch(String body) throws Exception {
        return mvc.perform(MockMvcRequestBuilders.patch("/jobs/" + JOB)
                .header("Authorization", "Bearer " + TestAuth.accessToken(jwt, user))
                .contentType(MediaType.APPLICATION_JSON).content(body));
    }

    private ResultActions get(String path) throws Exception {
        return mvc.perform(MockMvcRequestBuilders.get(path)
                .header("Authorization", "Bearer " + TestAuth.accessToken(jwt, user)));
    }
}
