package com.transuai.gateway.web;

import java.util.List;
import java.util.UUID;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import com.transuai.gateway.grpc.JobOwnershipGuard;
import com.transuai.gateway.ratelimit.CostlyFeature;
import com.transuai.gateway.web.dto.AssignSegmentSpeakerRequestDto;
import com.transuai.gateway.web.dto.RenameSpeakerRequestDto;
import com.transuai.gateway.web.dto.SegmentDto;
import com.transuai.gateway.web.dto.SegmentSpeakerUpdateDto;
import com.transuai.gateway.web.dto.SegmentUpdateDto;
import com.transuai.gateway.web.dto.SpeakerDto;
import com.transuai.gateway.web.dto.SpeakerUpdateDto;
import com.transuai.gateway.web.dto.TranscriptDto;
import com.transuai.gateway.web.dto.UpdateSegmentTextRequestDto;

import lombok.RequiredArgsConstructor;
import transuai.transcription.v1.Transcription.AssignSegmentSpeakerRequest;
import transuai.transcription.v1.Transcription.AssignSegmentSpeakerResponse;
import transuai.transcription.v1.Transcription.GetTranscriptRequest;
import transuai.transcription.v1.Transcription.NewSpeaker;
import transuai.transcription.v1.Transcription.RenameSpeakerRequest;
import transuai.transcription.v1.Transcription.RenameSpeakerResponse;
import transuai.transcription.v1.Transcription.Speaker;
import transuai.transcription.v1.Transcription.Transcript;
import transuai.transcription.v1.Transcription.TranscriptSegment;
import transuai.transcription.v1.Transcription.UpdateSegmentTextRequest;
import transuai.transcription.v1.Transcription.UpdateSegmentTextResponse;
import transuai.transcription.v1.TranscriptionServiceGrpc;

// 對應 ../../architecture-design.md 3.3。TranscriptionService 不驗證 x-user-id
// （見 ../../infra/proto/transcription.proto 的註解，只信任內部網路呼叫），這裡呼叫前
// 改用 JobOwnershipGuard 先跟 upload-service 確認 job 的擁有者，擋掉查到別人 job 的逐字稿。
@RestController
@RequiredArgsConstructor
public class TranscriptionController {

    private final TranscriptionServiceGrpc.TranscriptionServiceBlockingStub transcriptionServiceStub;
    private final JobOwnershipGuard jobOwnershipGuard;

    @GetMapping("/transcripts/{jobId}")
    public TranscriptDto getTranscript(@CurrentUserId UUID userId, @PathVariable String jobId) {
        jobOwnershipGuard.check(userId, jobId);
        return toDto(fetchTranscript(jobId));
    }

    @GetMapping("/transcripts/{jobId}/segments")
    public List<SegmentDto> getSegments(@CurrentUserId UUID userId, @PathVariable String jobId) {
        jobOwnershipGuard.check(userId, jobId);
        return toDto(fetchTranscript(jobId)).segments();
    }

    // 編輯片段文字（空字串＝清空、送回 originalText＝還原），見 transcription.proto 的 UpdateSegmentText。
    @CostlyFeature("transcript-edit")
    @PatchMapping("/transcripts/{jobId}/segments/{segmentId}")
    public SegmentUpdateDto updateSegmentText(@CurrentUserId UUID userId, @PathVariable String jobId,
            @PathVariable String segmentId, @RequestBody UpdateSegmentTextRequestDto request) {
        if (request == null || request.text() == null) {
            // Without this a body like {} or a misspelt key would silently clear the segment.
            throw new IllegalArgumentException("text is required"); // → 400 via GrpcExceptionAdvice
        }
        jobOwnershipGuard.check(userId, jobId);
        UpdateSegmentTextResponse response = transcriptionServiceStub.updateSegmentText(
                UpdateSegmentTextRequest.newBuilder()
                        .setJobId(jobId)
                        .setSegmentId(segmentId)
                        .setText(request.text())
                        .build());
        return new SegmentUpdateDto(toDto(response.getSegment()), response.getRevision());
    }

    // 替講者命名（name 空字串＝恢復預設名稱），見 transcription.proto 的 RenameSpeaker。
    @CostlyFeature("transcript-edit")
    @PatchMapping("/transcripts/{jobId}/speakers/{label}")
    public SpeakerUpdateDto renameSpeaker(@CurrentUserId UUID userId, @PathVariable String jobId,
            @PathVariable String label, @RequestBody RenameSpeakerRequestDto request) {
        if (request == null || request.name() == null) {
            // Without this a body like {} would silently reset the name.
            throw new IllegalArgumentException("name is required"); // → 400 via GrpcExceptionAdvice
        }
        jobOwnershipGuard.check(userId, jobId);
        RenameSpeakerResponse response = transcriptionServiceStub.renameSpeaker(
                RenameSpeakerRequest.newBuilder()
                        .setJobId(jobId)
                        .setLabel(label)
                        .setName(request.name())
                        .build());
        return new SpeakerUpdateDto(toDto(response.getSpeaker()), response.getRevision());
    }

    // 把片段改成另一位講者，或新增一位講者給它，見 transcription.proto 的 AssignSegmentSpeaker。
    @CostlyFeature("transcript-edit")
    @PutMapping("/transcripts/{jobId}/segments/{segmentId}/speaker")
    public SegmentSpeakerUpdateDto assignSegmentSpeaker(@CurrentUserId UUID userId, @PathVariable String jobId,
            @PathVariable String segmentId, @RequestBody AssignSegmentSpeakerRequestDto request) {
        if (request == null || (request.speakerLabel() == null) == (request.newSpeaker() == null)) {
            throw new IllegalArgumentException("exactly one of speakerLabel or newSpeaker is required"); // → 400
        }
        jobOwnershipGuard.check(userId, jobId);
        AssignSegmentSpeakerRequest.Builder grpcRequest = AssignSegmentSpeakerRequest.newBuilder()
                .setJobId(jobId)
                .setSegmentId(segmentId);
        if (request.speakerLabel() != null) {
            grpcRequest.setSpeakerLabel(request.speakerLabel());
        } else {
            String name = request.newSpeaker().name();
            grpcRequest.setNewSpeaker(NewSpeaker.newBuilder().setName(name == null ? "" : name));
        }
        AssignSegmentSpeakerResponse response = transcriptionServiceStub.assignSegmentSpeaker(grpcRequest.build());
        List<SpeakerDto> speakers = response.getSpeakersList().stream()
                .map(TranscriptionController::toDto)
                .toList();
        return new SegmentSpeakerUpdateDto(toDto(response.getSegment()), speakers, response.getRevision());
    }

    private Transcript fetchTranscript(String jobId) {
        return transcriptionServiceStub.getTranscript(GetTranscriptRequest.newBuilder().setJobId(jobId).build());
    }

    private static TranscriptDto toDto(Transcript transcript) {
        List<SegmentDto> segments = transcript.getSegmentsList().stream()
                .map(TranscriptionController::toDto)
                .toList();
        List<SpeakerDto> speakers = transcript.getSpeakersList().stream()
                .map(TranscriptionController::toDto)
                .toList();
        return new TranscriptDto(transcript.getJobId(), transcript.getLanguage(), transcript.getFullText(),
                segments, transcript.getRevision(), speakers);
    }

    private static SpeakerDto toDto(Speaker s) {
        return new SpeakerDto(s.getLabel(), s.getDisplayName(), s.getDisplayOrder());
    }

    private static SegmentDto toDto(TranscriptSegment s) {
        String speakerLabel = s.getSpeakerLabel().isEmpty() ? null : s.getSpeakerLabel();
        return new SegmentDto(s.getId(), s.getStartTime(), s.getEndTime(), speakerLabel, s.getText(),
                s.getOriginalText());
    }
}
