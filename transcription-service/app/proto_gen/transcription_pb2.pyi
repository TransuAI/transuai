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
