from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class Summary(_message.Message):
    __slots__ = ("job_id", "summary_text")
    JOB_ID_FIELD_NUMBER: _ClassVar[int]
    SUMMARY_TEXT_FIELD_NUMBER: _ClassVar[int]
    job_id: str
    summary_text: str
    def __init__(self, job_id: _Optional[str] = ..., summary_text: _Optional[str] = ...) -> None: ...

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

class AskQuestionResponse(_message.Message):
    __slots__ = ("answer", "source_timestamps")
    ANSWER_FIELD_NUMBER: _ClassVar[int]
    SOURCE_TIMESTAMPS_FIELD_NUMBER: _ClassVar[int]
    answer: str
    source_timestamps: _containers.RepeatedScalarFieldContainer[float]
    def __init__(self, answer: _Optional[str] = ..., source_timestamps: _Optional[_Iterable[float]] = ...) -> None: ...
