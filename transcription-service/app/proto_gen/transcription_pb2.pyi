from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class TranscriptSegment(_message.Message):
    __slots__ = ("start_time", "end_time", "speaker_label", "text")
    START_TIME_FIELD_NUMBER: _ClassVar[int]
    END_TIME_FIELD_NUMBER: _ClassVar[int]
    SPEAKER_LABEL_FIELD_NUMBER: _ClassVar[int]
    TEXT_FIELD_NUMBER: _ClassVar[int]
    start_time: float
    end_time: float
    speaker_label: str
    text: str
    def __init__(self, start_time: _Optional[float] = ..., end_time: _Optional[float] = ..., speaker_label: _Optional[str] = ..., text: _Optional[str] = ...) -> None: ...

class Transcript(_message.Message):
    __slots__ = ("job_id", "language", "full_text", "segments")
    JOB_ID_FIELD_NUMBER: _ClassVar[int]
    LANGUAGE_FIELD_NUMBER: _ClassVar[int]
    FULL_TEXT_FIELD_NUMBER: _ClassVar[int]
    SEGMENTS_FIELD_NUMBER: _ClassVar[int]
    job_id: str
    language: str
    full_text: str
    segments: _containers.RepeatedCompositeFieldContainer[TranscriptSegment]
    def __init__(self, job_id: _Optional[str] = ..., language: _Optional[str] = ..., full_text: _Optional[str] = ..., segments: _Optional[_Iterable[_Union[TranscriptSegment, _Mapping]]] = ...) -> None: ...

class GetTranscriptRequest(_message.Message):
    __slots__ = ("job_id",)
    JOB_ID_FIELD_NUMBER: _ClassVar[int]
    job_id: str
    def __init__(self, job_id: _Optional[str] = ...) -> None: ...
