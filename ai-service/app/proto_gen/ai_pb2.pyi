import datetime

from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class Summary(_message.Message):
    __slots__ = ("job_id", "summary_text", "source_revision")
    JOB_ID_FIELD_NUMBER: _ClassVar[int]
    SUMMARY_TEXT_FIELD_NUMBER: _ClassVar[int]
    SOURCE_REVISION_FIELD_NUMBER: _ClassVar[int]
    job_id: str
    summary_text: str
    source_revision: int
    def __init__(self, job_id: _Optional[str] = ..., summary_text: _Optional[str] = ..., source_revision: _Optional[int] = ...) -> None: ...

class GetSummaryRequest(_message.Message):
    __slots__ = ("job_id",)
    JOB_ID_FIELD_NUMBER: _ClassVar[int]
    job_id: str
    def __init__(self, job_id: _Optional[str] = ...) -> None: ...

class Chapter(_message.Message):
    __slots__ = ("id", "job_id", "title", "start_time", "sequence_no")
    ID_FIELD_NUMBER: _ClassVar[int]
    JOB_ID_FIELD_NUMBER: _ClassVar[int]
    TITLE_FIELD_NUMBER: _ClassVar[int]
    START_TIME_FIELD_NUMBER: _ClassVar[int]
    SEQUENCE_NO_FIELD_NUMBER: _ClassVar[int]
    id: str
    job_id: str
    title: str
    start_time: float
    sequence_no: int
    def __init__(self, id: _Optional[str] = ..., job_id: _Optional[str] = ..., title: _Optional[str] = ..., start_time: _Optional[float] = ..., sequence_no: _Optional[int] = ...) -> None: ...

class ListChaptersRequest(_message.Message):
    __slots__ = ("job_id",)
    JOB_ID_FIELD_NUMBER: _ClassVar[int]
    job_id: str
    def __init__(self, job_id: _Optional[str] = ...) -> None: ...

class ListChaptersResponse(_message.Message):
    __slots__ = ("chapters",)
    CHAPTERS_FIELD_NUMBER: _ClassVar[int]
    chapters: _containers.RepeatedCompositeFieldContainer[Chapter]
    def __init__(self, chapters: _Optional[_Iterable[_Union[Chapter, _Mapping]]] = ...) -> None: ...

class AskQuestionRequest(_message.Message):
    __slots__ = ("job_id", "user_id", "question")
    JOB_ID_FIELD_NUMBER: _ClassVar[int]
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    QUESTION_FIELD_NUMBER: _ClassVar[int]
    job_id: str
    user_id: str
    question: str
    def __init__(self, job_id: _Optional[str] = ..., user_id: _Optional[str] = ..., question: _Optional[str] = ...) -> None: ...

class AskQuestionChunk(_message.Message):
    __slots__ = ("sources", "delta", "error")
    SOURCES_FIELD_NUMBER: _ClassVar[int]
    DELTA_FIELD_NUMBER: _ClassVar[int]
    ERROR_FIELD_NUMBER: _ClassVar[int]
    sources: SourceTimestamps
    delta: str
    error: str
    def __init__(self, sources: _Optional[_Union[SourceTimestamps, _Mapping]] = ..., delta: _Optional[str] = ..., error: _Optional[str] = ...) -> None: ...

class SourceTimestamps(_message.Message):
    __slots__ = ("source_timestamps",)
    SOURCE_TIMESTAMPS_FIELD_NUMBER: _ClassVar[int]
    source_timestamps: _containers.RepeatedScalarFieldContainer[float]
    def __init__(self, source_timestamps: _Optional[_Iterable[float]] = ...) -> None: ...

class ListQaHistoryRequest(_message.Message):
    __slots__ = ("job_id",)
    JOB_ID_FIELD_NUMBER: _ClassVar[int]
    job_id: str
    def __init__(self, job_id: _Optional[str] = ...) -> None: ...

class QaTurn(_message.Message):
    __slots__ = ("question", "answer", "source_timestamps", "created_at")
    QUESTION_FIELD_NUMBER: _ClassVar[int]
    ANSWER_FIELD_NUMBER: _ClassVar[int]
    SOURCE_TIMESTAMPS_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    question: str
    answer: str
    source_timestamps: _containers.RepeatedScalarFieldContainer[float]
    created_at: _timestamp_pb2.Timestamp
    def __init__(self, question: _Optional[str] = ..., answer: _Optional[str] = ..., source_timestamps: _Optional[_Iterable[float]] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class ListQaHistoryResponse(_message.Message):
    __slots__ = ("turns",)
    TURNS_FIELD_NUMBER: _ClassVar[int]
    turns: _containers.RepeatedCompositeFieldContainer[QaTurn]
    def __init__(self, turns: _Optional[_Iterable[_Union[QaTurn, _Mapping]]] = ...) -> None: ...
