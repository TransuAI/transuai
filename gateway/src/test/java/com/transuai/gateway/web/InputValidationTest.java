package com.transuai.gateway.web;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
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
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import com.transuai.gateway.RedisContainerConfig;
import com.transuai.gateway.TestAuth;
import com.transuai.gateway.security.JwtProperties;
import com.transuai.upload.grpc.v1.Job;
import com.transuai.upload.grpc.v1.Note;
import com.transuai.upload.grpc.v1.NoteServiceGrpc;
import com.transuai.upload.grpc.v1.UploadServiceGrpc;

/**
 * 請求的輸入驗證（.scratch/pre-launch-hardening/issues/21，ASVS 5.1.3、5.1.4、13.2.2）：每個請求的 DTO 就是它的 schema——欄位有長度、格式、範圍
 * 的限制，不認得的欄位也拒絕；錯誤說是哪個欄位，不帶 Jackson 的訊息。被擋下的不會送到下游。
 */
@SpringBootTest
@AutoConfigureMockMvc
@Import(RedisContainerConfig.class)
class InputValidationTest {

    private static final String JOB = "11111111-1111-1111-1111-111111111111";

    @Autowired
    private MockMvc mvc;

    @Autowired
    private StringRedisTemplate redis;

    @Autowired
    private JwtProperties jwt;

    @MockitoBean
    private UploadServiceGrpc.UploadServiceBlockingStub uploadServiceStub;

    @MockitoBean
    private NoteServiceGrpc.NoteServiceBlockingStub noteServiceStub;

    private final UUID user = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        redis.getConnectionFactory().getConnection().serverCommands().flushAll();
        when(uploadServiceStub.withInterceptors(any())).thenReturn(uploadServiceStub);
        when(uploadServiceStub.getJob(any())).thenReturn(Job.newBuilder().setJobId(JOB).setUserId(user.toString()).build());
        when(noteServiceStub.withInterceptors(any())).thenReturn(noteServiceStub);
        when(noteServiceStub.createNote(any())).thenReturn(Note.newBuilder().setNoteId("n1").setJobId(JOB).build());
    }

    @Test
    void textLongerThanItsLimitIsRefusedNamingTheField() throws Exception {
        send(post("/jobs/" + JOB + "/notes"), "{\"text\":\"" + "字".repeat(2001) + "\"}")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value("INVALID_ARGUMENT"))
                .andExpect(jsonPath("$.message").value("text 最多 2000 個字"));

        verify(noteServiceStub, never()).createNote(any());
    }

    @Test
    void textWithinItsLimitGoesThrough() throws Exception {
        send(post("/jobs/" + JOB + "/notes"), "{\"text\":\"" + "字".repeat(2000) + "\",\"timeSeconds\":12.5}")
                .andExpect(status().isOk());
    }

    @Test
    void aFieldTheRequestDoesNotHaveIsRefused() throws Exception {
        send(post("/jobs/" + JOB + "/notes"), "{\"text\":\"hi\",\"userId\":\"someone-else\"}")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value("不認得的欄位：userId"));

        verify(noteServiceStub, never()).createNote(any());
    }

    @Test
    void valuesOutsideTheirSetOrRangeAreRefused() throws Exception {
        send(post("/jobs/" + JOB + "/notes"), "{\"text\":\"hi\",\"source\":\"<script>\"}")
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.message").value("source 的值不正確"));
        send(post("/jobs/" + JOB + "/notes"), "{\"timeSeconds\":-1}")
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.message").value("timeSeconds 超出範圍"));
        send(post("/uploads/presign"), "{\"fileName\":\"a.mp3\",\"fileType\":\"AUDIO\",\"contentType\":\"audio/mpeg\",\"fileSizeBytes\":0}")
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.message").value("fileSizeBytes 超出範圍"));
    }

    @Test
    void listsHaveALimitToo() throws Exception {
        String answers = "[" + "0,".repeat(50) + "0]";
        send(post("/jobs/" + JOB + "/quizzes/q1/attempts"), "{\"answers\":" + answers + "}")
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.message").value("answers 最多 50 項"));
    }

    @Test
    void brokenJsonOrAWrongTypeSaysSoWithoutNamingInternalClasses() throws Exception {
        send(patch("/jobs/" + JOB), "{\"title\":")
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.message").value("請求的內容格式不正確"));
        send(post("/jobs/" + JOB + "/notes"), "{\"timeSeconds\":\"noon\"}")
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.message").value("請求的內容格式不正確"));
    }

    private ResultActions send(MockHttpServletRequestBuilder request, String body) throws Exception {
        return mvc.perform(request.header("Authorization", "Bearer " + TestAuth.accessToken(jwt, user))
                .contentType(MediaType.APPLICATION_JSON).content(body));
    }
}
