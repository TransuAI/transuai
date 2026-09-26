import datetime

from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class RegenerationStatus(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    REGENERATION_STATUS_IDLE: _ClassVar[RegenerationStatus]
    REGENERATION_STATUS_RUNNING: _ClassVar[RegenerationStatus]
    REGENERATION_STATUS_FAILED: _ClassVar[RegenerationStatus]
REGENERATION_STATUS_IDLE: RegenerationStatus
REGENERATION_STATUS_RUNNING: RegenerationStatus
REGENERATION_STATUS_FAILED: RegenerationStatus

class RequestRegenerationRequest(_message.Message):
    __slots__ = ("job_id", "user_id")
    JOB_ID_FIELD_NUMBER: _ClassVar[int]
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    job_id: str
    user_id: str
    def __init__(self, job_id: _Optional[str] = ..., user_id: _Optional[str] = ...) -> None: ...

class ListJobLlmUsageRequest(_message.Message):
    __slots__ = ("job_id",)
    JOB_ID_FIELD_NUMBER: _ClassVar[int]
    job_id: str
    def __init__(self, job_id: _Optional[str] = ...) -> None: ...

class ListJobLlmUsageResponse(_message.Message):
    __slots__ = ("records",)
    RECORDS_FIELD_NUMBER: _ClassVar[int]
    records: _containers.RepeatedCompositeFieldContainer[LlmUsage]
    def __init__(self, records: _Optional[_Iterable[_Union[LlmUsage, _Mapping]]] = ...) -> None: ...

class LlmUsage(_message.Message):
    __slots__ = ("feature", "provider", "model", "key_source", "input_tokens", "output_tokens", "succeeded", "created_at")
    FEATURE_FIELD_NUMBER: _ClassVar[int]
    PROVIDER_FIELD_NUMBER: _ClassVar[int]
    MODEL_FIELD_NUMBER: _ClassVar[int]
    KEY_SOURCE_FIELD_NUMBER: _ClassVar[int]
    INPUT_TOKENS_FIELD_NUMBER: _ClassVar[int]
    OUTPUT_TOKENS_FIELD_NUMBER: _ClassVar[int]
    SUCCEEDED_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    feature: str
    provider: str
    model: str
    key_source: str
    input_tokens: int
    output_tokens: int
    succeeded: bool
    created_at: _timestamp_pb2.Timestamp
    def __init__(self, feature: _Optional[str] = ..., provider: _Optional[str] = ..., model: _Optional[str] = ..., key_source: _Optional[str] = ..., input_tokens: _Optional[int] = ..., output_tokens: _Optional[int] = ..., succeeded: _Optional[bool] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class Summary(_message.Message):
    __slots__ = ("job_id", "summary_text", "source_revision", "regeneration_status")
    JOB_ID_FIELD_NUMBER: _ClassVar[int]
    SUMMARY_TEXT_FIELD_NUMBER: _ClassVar[int]
    SOURCE_REVISION_FIELD_NUMBER: _ClassVar[int]
    REGENERATION_STATUS_FIELD_NUMBER: _ClassVar[int]
    job_id: str
    summary_text: str
    source_revision: int
    regeneration_status: RegenerationStatus
    def __init__(self, job_id: _Optional[str] = ..., summary_text: _Optional[str] = ..., source_revision: _Optional[int] = ..., regeneration_status: _Optional[_Union[RegenerationStatus, str]] = ...) -> None: ...

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

class SaveProviderKeyRequest(_message.Message):
    __slots__ = ("user_id", "provider", "key")
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    PROVIDER_FIELD_NUMBER: _ClassVar[int]
    KEY_FIELD_NUMBER: _ClassVar[int]
    user_id: str
    provider: str
    key: str
    def __init__(self, user_id: _Optional[str] = ..., provider: _Optional[str] = ..., key: _Optional[str] = ...) -> None: ...

class ProviderKey(_message.Message):
    __slots__ = ("provider", "last4", "created_at")
    PROVIDER_FIELD_NUMBER: _ClassVar[int]
    LAST4_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    provider: str
    last4: str
    created_at: _timestamp_pb2.Timestamp
    def __init__(self, provider: _Optional[str] = ..., last4: _Optional[str] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class DeleteProviderKeyRequest(_message.Message):
    __slots__ = ("user_id", "provider")
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    PROVIDER_FIELD_NUMBER: _ClassVar[int]
    user_id: str
    provider: str
    def __init__(self, user_id: _Optional[str] = ..., provider: _Optional[str] = ...) -> None: ...

class DeleteProviderKeyResponse(_message.Message):
    __slots__ = ("deleted",)
    DELETED_FIELD_NUMBER: _ClassVar[int]
    deleted: bool
    def __init__(self, deleted: _Optional[bool] = ...) -> None: ...

class ListProviderKeysRequest(_message.Message):
    __slots__ = ("user_id",)
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    user_id: str
    def __init__(self, user_id: _Optional[str] = ...) -> None: ...

class ListProviderKeysResponse(_message.Message):
    __slots__ = ("keys",)
    KEYS_FIELD_NUMBER: _ClassVar[int]
    keys: _containers.RepeatedCompositeFieldContainer[ProviderKey]
    def __init__(self, keys: _Optional[_Iterable[_Union[ProviderKey, _Mapping]]] = ...) -> None: ...
