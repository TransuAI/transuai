package com.transuai.gateway.web;

import java.util.List;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

import com.transuai.gateway.web.dto.SegmentDto;
import com.transuai.gateway.web.dto.TranscriptDto;

import lombok.RequiredArgsConstructor;
import transuai.transcription.v1.Transcription.GetTranscriptRequest;
import transuai.transcription.v1.Transcription.Transcript;
import transuai.transcription.v1.TranscriptionServiceGrpc;

// 對應 ../../architecture-design.md 3.3。TranscriptionService 不驗證 x-user-id
// （見 ../../infra/proto/transcription.proto 的註解，只信任內部網路呼叫），這裡呼叫時也不用帶。
// 也因此這支端點目前只擋「沒登入」，不擋「查到別人 job 的逐字稿」——見 README 已知限制。
@RestController
@RequiredArgsConstructor
public class TranscriptionController {

    private final TranscriptionServiceGrpc.TranscriptionServiceBlockingStub transcriptionServiceStub;

    @GetMapping("/transcripts/{jobId}")
    public TranscriptDto getTranscript(@PathVariable String jobId) {
        return toDto(fetchTranscript(jobId));
    }

    @GetMapping("/transcripts/{jobId}/segments")
    public List<SegmentDto> getSegments(@PathVariable String jobId) {
        return toDto(fetchTranscript(jobId)).segments();
    }

    private Transcript fetchTranscript(String jobId) {
        return transcriptionServiceStub.getTranscript(GetTranscriptRequest.newBuilder().setJobId(jobId).build());
    }

    private static TranscriptDto toDto(Transcript transcript) {
        List<SegmentDto> segments = transcript.getSegmentsList().stream()
                .map(s -> new SegmentDto(s.getStartTime(), s.getEndTime(), s.getSpeakerLabel(), s.getText()))
                .toList();
        return new TranscriptDto(transcript.getJobId(), transcript.getLanguage(), transcript.getFullText(),
                segments);
    }
}
