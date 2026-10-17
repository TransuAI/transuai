package com.transuai.gateway.cache;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
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
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import com.transuai.gateway.RedisContainerConfig;
import com.transuai.gateway.TestAuth;
import com.transuai.gateway.grpc.JobOwnershipGuard;
import com.transuai.gateway.security.JwtProperties;
import com.transuai.upload.grpc.v1.Job;
import com.transuai.upload.grpc.v1.UploadServiceGrpc;

import io.grpc.Status;

import transuai.ai.v1.Ai.ListChaptersResponse;
import transuai.ai.v1.AiServiceGrpc;

/**
 * cache-aside：Job 的擁有者（見 .scratch/pre-launch-hardening/issues/05）。每個 Job 的 API 都先確認 Job 是這位使用者的，原本每次都
 * 問 upload-service；擁有者不會變，記在 Redis。
 */
@SpringBootTest
@AutoConfigureMockMvc
@Import(RedisContainerConfig.class)
class JobOwnerCacheTest {

    private static final String JOB = "11111111-1111-1111-1111-111111111111";

    @Autowired
    private MockMvc mvc;

    @Autowired
    private StringRedisTemplate redis;

    @Autowired
    private JwtProperties jwt;

    @Autowired
    private JobOwnershipGuard guard;

    @Autowired
    private JobOwnerCache cache;

    @MockitoBean
    private UploadServiceGrpc.UploadServiceBlockingStub uploadServiceStub;

    @MockitoBean
    private AiServiceGrpc.AiServiceBlockingStub aiServiceStub;

    private final UUID alice = UUID.randomUUID();
    private final UUID bob = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        redis.getConnectionFactory().getConnection().serverCommands().flushAll();
        when(uploadServiceStub.withInterceptors(any())).thenReturn(uploadServiceStub);
        when(uploadServiceStub.getJob(any())).thenReturn(Job.newBuilder().setJobId(JOB).build());
        when(aiServiceStub.listChapters(any())).thenReturn(ListChaptersResponse.getDefaultInstance());
    }

    @Test
    void aJobsOwnerIsLookedUpOnceAndThenRemembered() throws Exception {
        chapters(alice).andExpect(status().isOk());
        chapters(alice).andExpect(status().isOk());

        verify(uploadServiceStub, times(1)).getJob(any());
    }

    @Test
    void someoneElseAskingForARememberedJobStillGetsNotFound() throws Exception {
        chapters(alice).andExpect(status().isOk());

        chapters(bob).andExpect(status().isNotFound());
        verify(uploadServiceStub, times(1)).getJob(any());  // 不用再問：擁有者是 alice
    }

    @Test
    void aDeletedJobIsNotFoundStraightAway() throws Exception {
        chapters(alice).andExpect(status().isOk());

        as(alice, delete("/jobs/" + JOB)).andExpect(status().isNoContent());

        chapters(alice).andExpect(status().isNotFound());
        verify(uploadServiceStub, times(1)).getJob(any());  // 刪除的標記直接回答，不用再問
    }

    @Test
    void aJobThatIsNotFoundIsNotRemembered() throws Exception {
        doThrow(Status.NOT_FOUND.withDescription("job not found").asRuntimeException())
                .when(uploadServiceStub).getJob(any());

        chapters(alice).andExpect(status().isNotFound());
        chapters(alice).andExpect(status().isNotFound());

        verify(uploadServiceStub, times(2)).getJob(any());
    }

    @Test
    void anOwnerIsRememberedForTenMinutes() throws Exception {
        chapters(alice).andExpect(status().isOk());

        assertThat(redis.keys("job-owner:*")).singleElement()
                .satisfies(key -> assertThat(redis.getExpire(key)).isBetween(9 * 60L, 10 * 60L));
    }

    @Test
    void fetchingAJobRemembersItsOwnerToo() throws Exception {
        guard.fetch(alice, JOB);  // 例如開始會後處理，要 Job 的上傳時間

        chapters(alice).andExpect(status().isOk());
        verify(uploadServiceStub, times(1)).getJob(any());
    }

    @Test
    void theSameJobWrittenInCapitalsIsTheSameEntry() throws Exception {
        chapters(alice).andExpect(status().isOk());

        as(alice, get("/chapters/" + JOB.toUpperCase())).andExpect(status().isOk());
        verify(uploadServiceStub, times(1)).getJob(any());
    }

    @Test
    void anOwnerLookedUpBeforeTheJobWasDeletedIsNotRememberedAfterIt() throws Exception {
        guard.forget(JOB);  // 刪掉了
        cache.remember(JOB, alice);  // 刪除之前就在路上的請求，這時才寫回

        chapters(alice).andExpect(status().isNotFound());
        verify(uploadServiceStub, times(0)).getJob(any());
    }

    @Test
    void aGarbledEntryIsTreatedAsNotRemembered() throws Exception {
        redis.opsForValue().set("job-owner:" + JOB, "not-a-uuid");

        chapters(alice).andExpect(status().isOk());
        verify(uploadServiceStub, times(1)).getJob(any());
    }

    private ResultActions chapters(UUID user) throws Exception {
        return as(user, get("/chapters/" + JOB));
    }

    private ResultActions as(UUID user, MockHttpServletRequestBuilder request) throws Exception {
        return mvc.perform(request.header("Authorization", "Bearer " + TestAuth.accessToken(jwt, user)));
    }
}
