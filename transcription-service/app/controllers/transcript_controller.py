import logging
import uuid
from datetime import timezone
from typing import NoReturn

import grpc
from google.protobuf import timestamp_pb2

from app.db import new_session
from app.models import Speaker, TranscriptionUsage, TranscriptSegment
from app.proto_gen import transcription_pb2, transcription_pb2_grpc
from app.repositories.transcript_repository import (
    NewSpeaker,
    SegmentNotFound,
    SpeakerNotFound,
    assign_segment_speaker,
    find_by_job_id,
    rename_speaker,
    update_segment_text,
)
from app.repositories.transcription_usage_repository import list_job_transcription_usage, sum_user_transcription_usage
from app.services import job_deletion, transcript_cache
from app.services.edit_events import publish_transcript_edited

logger = logging.getLogger(__name__)


# 一個片段通常只有一句話；這個上限只是擋掉明顯異常的輸入，不是給使用者碰的限制。
MAX_SEGMENT_TEXT_LENGTH = 2000
# 跟 speakers.name 欄位長度一致。
MAX_SPEAKER_NAME_LENGTH = 100


def _parse_uuid(value: str, field: str, context: grpc.ServicerContext) -> uuid.UUID:
    try:
        return uuid.UUID(value)
    except ValueError:
        _abort(context, grpc.StatusCode.INVALID_ARGUMENT, f"{field} must be a valid UUID")


def _abort(context: grpc.ServicerContext, code: grpc.StatusCode, message: str) -> NoReturn:
    context.abort(code, message)
    raise AssertionError("unreachable")  # context.abort() 保證會 raise 中斷 RPC


def _segment_to_proto(segment: TranscriptSegment) -> transcription_pb2.TranscriptSegment:
    return transcription_pb2.TranscriptSegment(
        id=str(segment.id),
        start_time=float(segment.start_time),
        end_time=float(segment.end_time),
        speaker_label=segment.speaker_label or "",
        text=segment.text,
        original_text=segment.original_text,
    )


def _speaker_to_proto(speaker: Speaker) -> transcription_pb2.Speaker:
    return transcription_pb2.Speaker(
        label=speaker.label, display_name=speaker.display_name, display_order=speaker.display_order)


def _normalized_speaker_name(name: str, context: grpc.ServicerContext) -> str | None:
    """去前後空白；空字串＝沒有名稱（預設名稱「講者 N」）。"""
    name = name.strip()
    if len(name) > MAX_SPEAKER_NAME_LENGTH:
        _abort(context, grpc.StatusCode.INVALID_ARGUMENT,
               f"name must be at most {MAX_SPEAKER_NAME_LENGTH} characters")
    return name or None


def _usage_to_proto(usage: TranscriptionUsage) -> transcription_pb2.TranscriptionUsage:
    created_at = timestamp_pb2.Timestamp()
    created_at.FromDatetime(usage.created_at)
    record = transcription_pb2.TranscriptionUsage(
        provider=usage.provider, model=usage.model, succeeded=usage.succeeded, created_at=created_at)
    if usage.audio_seconds is not None:  # 未知就不設定（proto3 optional），跟 0 分得開
        record.audio_seconds = usage.audio_seconds
    return record


def _after_edit(job_id: uuid.UUID, revision: int, context: grpc.ServicerContext) -> None:
    """逐字稿真的改了（已經寫進資料庫）之後：快取記下新的 revision，並通知 ai-service 重算 embedding。編輯的同時 Job 被刪掉了
    （見 job_deletion）就丟掉這次寫入、回 NOT_FOUND。"""
    transcript_cache.record_edit(job_id, revision)
    if job_deletion.discard_if_deleted(job_id):
        _abort(context, grpc.StatusCode.NOT_FOUND, "job was deleted")
    publish_transcript_edited(str(job_id))


class TranscriptController(transcription_pb2_grpc.TranscriptionServiceServicer):
    def GetTranscript(self, request, context):
        job_id = _parse_uuid(request.job_id, "job_id", context)
        # cache-aside（見 transcript_cache）：找不到的逐字稿不記。
        if (cached := transcript_cache.cached(job_id)) is not None:
            return cached

        session = new_session()
        try:
            transcript = find_by_job_id(session, job_id)
            if transcript is None:
                _abort(context, grpc.StatusCode.NOT_FOUND, "transcript not found")

            response = transcription_pb2.Transcript(
                job_id=str(transcript.job_id),
                language=transcript.language or "",
                full_text=transcript.full_text or "",
                segments=[_segment_to_proto(seg) for seg in transcript.segments],
                revision=transcript.revision,
                speakers=[_speaker_to_proto(speaker) for speaker in transcript.speakers],
            )
        finally:
            session.close()
        transcript_cache.remember(job_id, response)
        return response

    def UpdateSegmentText(self, request, context):
        job_id = _parse_uuid(request.job_id, "job_id", context)
        segment_id = _parse_uuid(request.segment_id, "segment_id", context)
        text = request.text.strip()
        if len(text) > MAX_SEGMENT_TEXT_LENGTH:
            _abort(context, grpc.StatusCode.INVALID_ARGUMENT,
                   f"text must be at most {MAX_SEGMENT_TEXT_LENGTH} characters")

        session = new_session()
        try:
            try:
                edit = update_segment_text(session, job_id, segment_id, text)
            except SegmentNotFound:
                _abort(context, grpc.StatusCode.NOT_FOUND, "segment not found in this job's transcript")
            if edit.changed:
                _after_edit(job_id, edit.revision, context)
            return transcription_pb2.UpdateSegmentTextResponse(
                segment=_segment_to_proto(edit.segment), revision=edit.revision)
        finally:
            session.close()

    def RenameSpeaker(self, request, context):
        job_id = _parse_uuid(request.job_id, "job_id", context)
        name = _normalized_speaker_name(request.name, context)

        session = new_session()
        try:
            try:
                edit = rename_speaker(session, job_id, request.label, name)
            except SpeakerNotFound:
                _abort(context, grpc.StatusCode.NOT_FOUND, "speaker not found in this job's transcript")
            if edit.changed:
                _after_edit(job_id, edit.revision, context)
            return transcription_pb2.RenameSpeakerResponse(
                speaker=_speaker_to_proto(edit.speaker), revision=edit.revision)
        finally:
            session.close()

    def AssignSegmentSpeaker(self, request, context):
        job_id = _parse_uuid(request.job_id, "job_id", context)
        segment_id = _parse_uuid(request.segment_id, "segment_id", context)
        match request.WhichOneof("target"):
            case "speaker_label":
                target: str | NewSpeaker = request.speaker_label
            case "new_speaker":
                target = NewSpeaker(_normalized_speaker_name(request.new_speaker.name, context))
            case _:
                _abort(context, grpc.StatusCode.INVALID_ARGUMENT, "either speaker_label or new_speaker is required")

        session = new_session()
        try:
            try:
                assignment = assign_segment_speaker(session, job_id, segment_id, target)
            except SegmentNotFound:
                _abort(context, grpc.StatusCode.NOT_FOUND, "segment not found in this job's transcript")
            except SpeakerNotFound:
                _abort(context, grpc.StatusCode.NOT_FOUND, "speaker not found in this job's transcript")
            if assignment.changed:
                _after_edit(job_id, assignment.revision, context)
            return transcription_pb2.AssignSegmentSpeakerResponse(
                segment=_segment_to_proto(assignment.segment),
                speakers=[_speaker_to_proto(speaker) for speaker in assignment.speakers],
                revision=assignment.revision,
            )
        finally:
            session.close()

    def ListJobTranscriptionUsage(self, request, context):
        job_id = _parse_uuid(request.job_id, "job_id", context)
        session = new_session()
        try:
            return transcription_pb2.ListJobTranscriptionUsageResponse(
                records=[_usage_to_proto(usage) for usage in list_job_transcription_usage(session, job_id)])
        finally:
            session.close()

    def SumUserTranscriptionUsage(self, request, context):
        user_id = _parse_uuid(request.user_id, "user_id", context)
        if not (request.HasField("start") and request.HasField("end")):
            _abort(context, grpc.StatusCode.INVALID_ARGUMENT, "start and end are required")
        session = new_session()
        try:
            sums = sum_user_transcription_usage(session, user_id, request.start.ToDatetime(timezone.utc),
                                                request.end.ToDatetime(timezone.utc))
        finally:
            session.close()
        return transcription_pb2.SumUserTranscriptionUsageResponse(sums=[
            transcription_pb2.TranscriptionUsageSum(provider=s.provider, model=s.model, audio_seconds=s.audio_seconds,
                                                    calls=s.calls, calls_with_unknown_usage=s.calls_with_unknown_usage)
            for s in sums])
