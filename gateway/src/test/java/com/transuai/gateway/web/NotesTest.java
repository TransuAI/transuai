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
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;

import com.google.protobuf.Empty;
import com.transuai.gateway.RedisContainerConfig;
import com.transuai.gateway.TestAuth;
import com.transuai.gateway.security.JwtProperties;
import com.transuai.upload.grpc.v1.CreateNoteRequest;
import com.transuai.upload.grpc.v1.ListNotesResponse;
import com.transuai.upload.grpc.v1.Note;
import com.transuai.upload.grpc.v1.NoteServiceGrpc;
import com.transuai.upload.grpc.v1.UpdateNoteRequest;

import io.grpc.Status;

/** 筆記（見 .scratch/job-notes）：轉給 upload-service 的 NoteService，帶上登入者（ownership 由 upload-service 檢查）。 */
@SpringBootTest
@AutoConfigureMockMvc
@Import(RedisContainerConfig.class)
class NotesTest {

    private static final String JOB = "11111111-1111-1111-1111-111111111111";
    private static final String NOTE = "22222222-2222-2222-2222-222222222222";

    @Autowired
    private MockMvc mvc;

    @Autowired
    private StringRedisTemplate redis;

    @Autowired
    private JwtProperties jwt;

    @MockitoBean
    private NoteServiceGrpc.NoteServiceBlockingStub noteServiceStub;

    private final UUID user = UUID.randomUUID();

    private final Note note = Note.newBuilder().setNoteId(NOTE).setJobId(JOB).setTimeSeconds(30).setText("預算要再確認")
            .setSource("manual").build();

    @BeforeEach
    void setUp() {
        redis.getConnectionFactory().getConnection().serverCommands().flushAll();
        when(noteServiceStub.withInterceptors(any())).thenReturn(noteServiceStub);
    }

    @Test
    void theJobsNotesAreListed() throws Exception {
        when(noteServiceStub.listNotes(any())).thenReturn(ListNotesResponse.newBuilder().addNotes(note)
                .addNotes(Note.newBuilder().setNoteId("n2").setJobId(JOB).setText("心得").setSource("qa")).build());

        call(MockMvcRequestBuilders.get("/jobs/" + JOB + "/notes"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].noteId").value(NOTE))
                .andExpect(jsonPath("$[0].timeSeconds").value(30.0))
                .andExpect(jsonPath("$[0].text").value("預算要再確認"))
                .andExpect(jsonPath("$[1].timeSeconds").isEmpty())  // not pinned to a time
                .andExpect(jsonPath("$[1].source").value("qa"));
    }

    @Test
    void aNoteIsAddedWithOrWithoutATime() throws Exception {
        when(noteServiceStub.createNote(any())).thenReturn(note);

        call(MockMvcRequestBuilders.post("/jobs/" + JOB + "/notes").contentType(MediaType.APPLICATION_JSON)
                .content("{\"timeSeconds\":30,\"text\":\"預算要再確認\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.noteId").value(NOTE));
        call(MockMvcRequestBuilders.post("/jobs/" + JOB + "/notes").contentType(MediaType.APPLICATION_JSON)
                .content("{\"text\":\"心得\",\"source\":\"qa\"}"));

        ArgumentCaptor<CreateNoteRequest> sent = ArgumentCaptor.forClass(CreateNoteRequest.class);
        verify(noteServiceStub, org.mockito.Mockito.times(2)).createNote(sent.capture());
        assertThat(sent.getAllValues().get(0).getTimeSeconds()).isEqualTo(30.0);
        assertThat(sent.getAllValues().get(1).hasTimeSeconds()).isFalse();
        assertThat(sent.getAllValues().get(1).getSource()).isEqualTo("qa");
    }

    @Test
    void aNoteIsEditedAndDeleted() throws Exception {
        when(noteServiceStub.updateNote(any())).thenReturn(note.toBuilder().setText("週五前").build());
        when(noteServiceStub.deleteNote(any())).thenReturn(Empty.getDefaultInstance());

        call(MockMvcRequestBuilders.patch("/jobs/" + JOB + "/notes/" + NOTE).contentType(MediaType.APPLICATION_JSON)
                .content("{\"text\":\"週五前\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.text").value("週五前"));
        call(MockMvcRequestBuilders.delete("/jobs/" + JOB + "/notes/" + NOTE)).andExpect(status().isNoContent());

        ArgumentCaptor<UpdateNoteRequest> sent = ArgumentCaptor.forClass(UpdateNoteRequest.class);
        verify(noteServiceStub).updateNote(sent.capture());
        assertThat(sent.getValue().getNoteId()).isEqualTo(NOTE);
    }

    @Test
    void aNoteThatIsNotANoteIsABadRequestAndSomeoneElsesJobIsNotFound() throws Exception {
        when(noteServiceStub.createNote(any())).thenThrow(Status.INVALID_ARGUMENT.withDescription("too long").asRuntimeException());
        when(noteServiceStub.listNotes(any())).thenThrow(Status.NOT_FOUND.asRuntimeException());

        call(MockMvcRequestBuilders.post("/jobs/" + JOB + "/notes").contentType(MediaType.APPLICATION_JSON)
                .content("{\"text\":\"x\"}")).andExpect(status().isBadRequest());
        call(MockMvcRequestBuilders.get("/jobs/" + JOB + "/notes")).andExpect(status().isNotFound());
    }

    private ResultActions call(MockHttpServletRequestBuilder request) throws Exception {
        return mvc.perform(request.header("Authorization", "Bearer " + TestAuth.accessToken(jwt, user)));
    }
}
