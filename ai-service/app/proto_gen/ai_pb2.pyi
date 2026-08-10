from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Optional as _Optional

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
