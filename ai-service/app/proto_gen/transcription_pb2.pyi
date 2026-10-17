import datetime

from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class TranscriptSegment(_message.Message):
    __slots__ = ("start_time", "end_time", "speaker_label", "text", "id", "original_text")
    START_TIME_FIELD_NUMBER: _ClassVar[int]
    END_TIME_FIELD_NUMBER: _ClassVar[int]
    SPEAKER_LABEL_FIELD_NUMBER: _ClassVar[int]
    TEXT_FIELD_NUMBER: _ClassVar[int]
    ID_FIELD_NUMBER: _ClassVar[int]
    ORIGINAL_TEXT_FIELD_NUMBER: _ClassVar[int]
    start_time: float
    end_time: float
    speaker_label: str
    text: str
    id: str
    original_text: str
    def __init__(self, start_time: _Optional[float] = ..., end_time: _Optional[float] = ..., speaker_label: _Optional[str] = ..., text: _Optional[str] = ..., id: _Optional[str] = ..., original_text: _Optional[str] = ...) -> None: ...

class Transcript(_message.Message):
    __slots__ = ("job_id", "language", "full_text", "segments", "revision", "speakers")
    JOB_ID_FIELD_NUMBER: _ClassVar[int]
    LANGUAGE_FIELD_NUMBER: _ClassVar[int]
    FULL_TEXT_FIELD_NUMBER: _ClassVar[int]
    SEGMENTS_FIELD_NUMBER: _ClassVar[int]
    REVISION_FIELD_NUMBER: _ClassVar[int]
    SPEAKERS_FIELD_NUMBER: _ClassVar[int]
    job_id: str
    language: str
    full_text: str
    segments: _containers.RepeatedCompositeFieldContainer[TranscriptSegment]
    revision: int
    speakers: _containers.RepeatedCompositeFieldContainer[Speaker]
    def __init__(self, job_id: _Optional[str] = ..., language: _Optional[str] = ..., full_text: _Optional[str] = ..., segments: _Optional[_Iterable[_Union[TranscriptSegment, _Mapping]]] = ..., revision: _Optional[int] = ..., speakers: _Optional[_Iterable[_Union[Speaker, _Mapping]]] = ...) -> None: ...

class Speaker(_message.Message):
    __slots__ = ("label", "display_name", "display_order")
    LABEL_FIELD_NUMBER: _ClassVar[int]
    DISPLAY_NAME_FIELD_NUMBER: _ClassVar[int]
    DISPLAY_ORDER_FIELD_NUMBER: _ClassVar[int]
    label: str
    display_name: str
    display_order: int
    def __init__(self, label: _Optional[str] = ..., display_name: _Optional[str] = ..., display_order: _Optional[int] = ...) -> None: ...

class GetTranscriptRequest(_message.Message):
    __slots__ = ("job_id",)
    JOB_ID_FIELD_NUMBER: _ClassVar[int]
    job_id: str
    def __init__(self, job_id: _Optional[str] = ...) -> None: ...

class UpdateSegmentTextRequest(_message.Message):
    __slots__ = ("job_id", "segment_id", "text")
    JOB_ID_FIELD_NUMBER: _ClassVar[int]
    SEGMENT_ID_FIELD_NUMBER: _ClassVar[int]
    TEXT_FIELD_NUMBER: _ClassVar[int]
    job_id: str
    segment_id: str
    text: str
    def __init__(self, job_id: _Optional[str] = ..., segment_id: _Optional[str] = ..., text: _Optional[str] = ...) -> None: ...

class UpdateSegmentTextResponse(_message.Message):
    __slots__ = ("segment", "revision")
    SEGMENT_FIELD_NUMBER: _ClassVar[int]
    REVISION_FIELD_NUMBER: _ClassVar[int]
    segment: TranscriptSegment
    revision: int
    def __init__(self, segment: _Optional[_Union[TranscriptSegment, _Mapping]] = ..., revision: _Optional[int] = ...) -> None: ...

class RenameSpeakerRequest(_message.Message):
    __slots__ = ("job_id", "label", "name")
    JOB_ID_FIELD_NUMBER: _ClassVar[int]
    LABEL_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    job_id: str
    label: str
    name: str
    def __init__(self, job_id: _Optional[str] = ..., label: _Optional[str] = ..., name: _Optional[str] = ...) -> None: ...

class RenameSpeakerResponse(_message.Message):
    __slots__ = ("speaker", "revision")
    SPEAKER_FIELD_NUMBER: _ClassVar[int]
    REVISION_FIELD_NUMBER: _ClassVar[int]
    speaker: Speaker
    revision: int
    def __init__(self, speaker: _Optional[_Union[Speaker, _Mapping]] = ..., revision: _Optional[int] = ...) -> None: ...

class AssignSegmentSpeakerRequest(_message.Message):
    __slots__ = ("job_id", "segment_id", "speaker_label", "new_speaker")
    JOB_ID_FIELD_NUMBER: _ClassVar[int]
    SEGMENT_ID_FIELD_NUMBER: _ClassVar[int]
    SPEAKER_LABEL_FIELD_NUMBER: _ClassVar[int]
    NEW_SPEAKER_FIELD_NUMBER: _ClassVar[int]
    job_id: str
    segment_id: str
    speaker_label: str
    new_speaker: NewSpeaker
    def __init__(self, job_id: _Optional[str] = ..., segment_id: _Optional[str] = ..., speaker_label: _Optional[str] = ..., new_speaker: _Optional[_Union[NewSpeaker, _Mapping]] = ...) -> None: ...

class NewSpeaker(_message.Message):
    __slots__ = ("name",)
    NAME_FIELD_NUMBER: _ClassVar[int]
    name: str
    def __init__(self, name: _Optional[str] = ...) -> None: ...

class AssignSegmentSpeakerResponse(_message.Message):
    __slots__ = ("segment", "speakers", "revision")
    SEGMENT_FIELD_NUMBER: _ClassVar[int]
    SPEAKERS_FIELD_NUMBER: _ClassVar[int]
    REVISION_FIELD_NUMBER: _ClassVar[int]
    segment: TranscriptSegment
    speakers: _containers.RepeatedCompositeFieldContainer[Speaker]
    revision: int
    def __init__(self, segment: _Optional[_Union[TranscriptSegment, _Mapping]] = ..., speakers: _Optional[_Iterable[_Union[Speaker, _Mapping]]] = ..., revision: _Optional[int] = ...) -> None: ...

class ListJobTranscriptionUsageRequest(_message.Message):
    __slots__ = ("job_id",)
    JOB_ID_FIELD_NUMBER: _ClassVar[int]
    job_id: str
    def __init__(self, job_id: _Optional[str] = ...) -> None: ...

class ListJobTranscriptionUsageResponse(_message.Message):
    __slots__ = ("records",)
    RECORDS_FIELD_NUMBER: _ClassVar[int]
    records: _containers.RepeatedCompositeFieldContainer[TranscriptionUsage]
    def __init__(self, records: _Optional[_Iterable[_Union[TranscriptionUsage, _Mapping]]] = ...) -> None: ...

class SumUserTranscriptionUsageRequest(_message.Message):
    __slots__ = ("user_id", "start", "end")
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    START_FIELD_NUMBER: _ClassVar[int]
    END_FIELD_NUMBER: _ClassVar[int]
    user_id: str
    start: _timestamp_pb2.Timestamp
    end: _timestamp_pb2.Timestamp
    def __init__(self, user_id: _Optional[str] = ..., start: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., end: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class SumUserTranscriptionUsageResponse(_message.Message):
    __slots__ = ("sums",)
    SUMS_FIELD_NUMBER: _ClassVar[int]
    sums: _containers.RepeatedCompositeFieldContainer[TranscriptionUsageSum]
    def __init__(self, sums: _Optional[_Iterable[_Union[TranscriptionUsageSum, _Mapping]]] = ...) -> None: ...

class TranscriptionUsageSum(_message.Message):
    __slots__ = ("provider", "model", "audio_seconds", "calls", "calls_with_unknown_usage")
    PROVIDER_FIELD_NUMBER: _ClassVar[int]
    MODEL_FIELD_NUMBER: _ClassVar[int]
    AUDIO_SECONDS_FIELD_NUMBER: _ClassVar[int]
    CALLS_FIELD_NUMBER: _ClassVar[int]
    CALLS_WITH_UNKNOWN_USAGE_FIELD_NUMBER: _ClassVar[int]
    provider: str
    model: str
    audio_seconds: float
    calls: int
    calls_with_unknown_usage: int
    def __init__(self, provider: _Optional[str] = ..., model: _Optional[str] = ..., audio_seconds: _Optional[float] = ..., calls: _Optional[int] = ..., calls_with_unknown_usage: _Optional[int] = ...) -> None: ...

class TranscriptionUsage(_message.Message):
    __slots__ = ("provider", "model", "audio_seconds", "succeeded", "created_at")
    PROVIDER_FIELD_NUMBER: _ClassVar[int]
    MODEL_FIELD_NUMBER: _ClassVar[int]
    AUDIO_SECONDS_FIELD_NUMBER: _ClassVar[int]
    SUCCEEDED_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    provider: str
    model: str
    audio_seconds: float
    succeeded: bool
    created_at: _timestamp_pb2.Timestamp
    def __init__(self, provider: _Optional[str] = ..., model: _Optional[str] = ..., audio_seconds: _Optional[float] = ..., succeeded: _Optional[bool] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...
