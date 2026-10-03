import datetime

from google.protobuf import empty_pb2 as _empty_pb2
from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class FileType(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    FILE_TYPE_UNSPECIFIED: _ClassVar[FileType]
    AUDIO: _ClassVar[FileType]
    VIDEO: _ClassVar[FileType]

class JobStatus(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    JOB_STATUS_UNSPECIFIED: _ClassVar[JobStatus]
    PENDING: _ClassVar[JobStatus]
    UPLOADING: _ClassVar[JobStatus]
    UPLOADED: _ClassVar[JobStatus]
    TRANSCRIBING: _ClassVar[JobStatus]
    TRANSCRIBED: _ClassVar[JobStatus]
    SUMMARIZING: _ClassVar[JobStatus]
    COMPLETED: _ClassVar[JobStatus]
    FAILED: _ClassVar[JobStatus]
FILE_TYPE_UNSPECIFIED: FileType
AUDIO: FileType
VIDEO: FileType
JOB_STATUS_UNSPECIFIED: JobStatus
PENDING: JobStatus
UPLOADING: JobStatus
UPLOADED: JobStatus
TRANSCRIBING: JobStatus
TRANSCRIBED: JobStatus
SUMMARIZING: JobStatus
COMPLETED: JobStatus
FAILED: JobStatus

class SetSuggestedDetailsRequest(_message.Message):
    __slots__ = ("job_id", "title", "category")
    JOB_ID_FIELD_NUMBER: _ClassVar[int]
    TITLE_FIELD_NUMBER: _ClassVar[int]
    CATEGORY_FIELD_NUMBER: _ClassVar[int]
    job_id: str
    title: str
    category: str
    def __init__(self, job_id: _Optional[str] = ..., title: _Optional[str] = ..., category: _Optional[str] = ...) -> None: ...

class Note(_message.Message):
    __slots__ = ("note_id", "job_id", "time_seconds", "text", "source", "created_at", "updated_at")
    NOTE_ID_FIELD_NUMBER: _ClassVar[int]
    JOB_ID_FIELD_NUMBER: _ClassVar[int]
    TIME_SECONDS_FIELD_NUMBER: _ClassVar[int]
    TEXT_FIELD_NUMBER: _ClassVar[int]
    SOURCE_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    UPDATED_AT_FIELD_NUMBER: _ClassVar[int]
    note_id: str
    job_id: str
    time_seconds: float
    text: str
    source: str
    created_at: _timestamp_pb2.Timestamp
    updated_at: _timestamp_pb2.Timestamp
    def __init__(self, note_id: _Optional[str] = ..., job_id: _Optional[str] = ..., time_seconds: _Optional[float] = ..., text: _Optional[str] = ..., source: _Optional[str] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., updated_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class ListNotesRequest(_message.Message):
    __slots__ = ("job_id",)
    JOB_ID_FIELD_NUMBER: _ClassVar[int]
    job_id: str
    def __init__(self, job_id: _Optional[str] = ...) -> None: ...

class ListNotesResponse(_message.Message):
    __slots__ = ("notes",)
    NOTES_FIELD_NUMBER: _ClassVar[int]
    notes: _containers.RepeatedCompositeFieldContainer[Note]
    def __init__(self, notes: _Optional[_Iterable[_Union[Note, _Mapping]]] = ...) -> None: ...

class CreateNoteRequest(_message.Message):
    __slots__ = ("job_id", "time_seconds", "text", "source")
    JOB_ID_FIELD_NUMBER: _ClassVar[int]
    TIME_SECONDS_FIELD_NUMBER: _ClassVar[int]
    TEXT_FIELD_NUMBER: _ClassVar[int]
    SOURCE_FIELD_NUMBER: _ClassVar[int]
    job_id: str
    time_seconds: float
    text: str
    source: str
    def __init__(self, job_id: _Optional[str] = ..., time_seconds: _Optional[float] = ..., text: _Optional[str] = ..., source: _Optional[str] = ...) -> None: ...

class UpdateNoteRequest(_message.Message):
    __slots__ = ("job_id", "note_id", "text")
    JOB_ID_FIELD_NUMBER: _ClassVar[int]
    NOTE_ID_FIELD_NUMBER: _ClassVar[int]
    TEXT_FIELD_NUMBER: _ClassVar[int]
    job_id: str
    note_id: str
    text: str
    def __init__(self, job_id: _Optional[str] = ..., note_id: _Optional[str] = ..., text: _Optional[str] = ...) -> None: ...

class DeleteNoteRequest(_message.Message):
    __slots__ = ("job_id", "note_id")
    JOB_ID_FIELD_NUMBER: _ClassVar[int]
    NOTE_ID_FIELD_NUMBER: _ClassVar[int]
    job_id: str
    note_id: str
    def __init__(self, job_id: _Optional[str] = ..., note_id: _Optional[str] = ...) -> None: ...

class Job(_message.Message):
    __slots__ = ("job_id", "user_id", "file_name", "file_type", "file_size_bytes", "storage_path", "duration_seconds", "status", "error_reason", "created_at", "updated_at", "transcription_language", "title", "category")
    JOB_ID_FIELD_NUMBER: _ClassVar[int]
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    FILE_NAME_FIELD_NUMBER: _ClassVar[int]
    FILE_TYPE_FIELD_NUMBER: _ClassVar[int]
    FILE_SIZE_BYTES_FIELD_NUMBER: _ClassVar[int]
    STORAGE_PATH_FIELD_NUMBER: _ClassVar[int]
    DURATION_SECONDS_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    ERROR_REASON_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    UPDATED_AT_FIELD_NUMBER: _ClassVar[int]
    TRANSCRIPTION_LANGUAGE_FIELD_NUMBER: _ClassVar[int]
    TITLE_FIELD_NUMBER: _ClassVar[int]
    CATEGORY_FIELD_NUMBER: _ClassVar[int]
    job_id: str
    user_id: str
    file_name: str
    file_type: FileType
    file_size_bytes: int
    storage_path: str
    duration_seconds: int
    status: JobStatus
    error_reason: str
    created_at: _timestamp_pb2.Timestamp
    updated_at: _timestamp_pb2.Timestamp
    transcription_language: str
    title: str
    category: str
    def __init__(self, job_id: _Optional[str] = ..., user_id: _Optional[str] = ..., file_name: _Optional[str] = ..., file_type: _Optional[_Union[FileType, str]] = ..., file_size_bytes: _Optional[int] = ..., storage_path: _Optional[str] = ..., duration_seconds: _Optional[int] = ..., status: _Optional[_Union[JobStatus, str]] = ..., error_reason: _Optional[str] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., updated_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., transcription_language: _Optional[str] = ..., title: _Optional[str] = ..., category: _Optional[str] = ...) -> None: ...

class GetPresignedUploadUrlRequest(_message.Message):
    __slots__ = ("file_name", "file_type", "file_size_bytes")
    FILE_NAME_FIELD_NUMBER: _ClassVar[int]
    FILE_TYPE_FIELD_NUMBER: _ClassVar[int]
    FILE_SIZE_BYTES_FIELD_NUMBER: _ClassVar[int]
    file_name: str
    file_type: FileType
    file_size_bytes: int
    def __init__(self, file_name: _Optional[str] = ..., file_type: _Optional[_Union[FileType, str]] = ..., file_size_bytes: _Optional[int] = ...) -> None: ...

class GetPresignedUploadUrlResponse(_message.Message):
    __slots__ = ("upload_url", "storage_path", "expires_at")
    UPLOAD_URL_FIELD_NUMBER: _ClassVar[int]
    STORAGE_PATH_FIELD_NUMBER: _ClassVar[int]
    EXPIRES_AT_FIELD_NUMBER: _ClassVar[int]
    upload_url: str
    storage_path: str
    expires_at: _timestamp_pb2.Timestamp
    def __init__(self, upload_url: _Optional[str] = ..., storage_path: _Optional[str] = ..., expires_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class CompleteUploadRequest(_message.Message):
    __slots__ = ("storage_path", "file_name", "file_type", "file_size_bytes", "duration_seconds", "transcription_language")
    STORAGE_PATH_FIELD_NUMBER: _ClassVar[int]
    FILE_NAME_FIELD_NUMBER: _ClassVar[int]
    FILE_TYPE_FIELD_NUMBER: _ClassVar[int]
    FILE_SIZE_BYTES_FIELD_NUMBER: _ClassVar[int]
    DURATION_SECONDS_FIELD_NUMBER: _ClassVar[int]
    TRANSCRIPTION_LANGUAGE_FIELD_NUMBER: _ClassVar[int]
    storage_path: str
    file_name: str
    file_type: FileType
    file_size_bytes: int
    duration_seconds: int
    transcription_language: str
    def __init__(self, storage_path: _Optional[str] = ..., file_name: _Optional[str] = ..., file_type: _Optional[_Union[FileType, str]] = ..., file_size_bytes: _Optional[int] = ..., duration_seconds: _Optional[int] = ..., transcription_language: _Optional[str] = ...) -> None: ...

class GetJobRequest(_message.Message):
    __slots__ = ("job_id",)
    JOB_ID_FIELD_NUMBER: _ClassVar[int]
    job_id: str
    def __init__(self, job_id: _Optional[str] = ...) -> None: ...

class GetPresignedDownloadUrlRequest(_message.Message):
    __slots__ = ("job_id", "as_attachment")
    JOB_ID_FIELD_NUMBER: _ClassVar[int]
    AS_ATTACHMENT_FIELD_NUMBER: _ClassVar[int]
    job_id: str
    as_attachment: bool
    def __init__(self, job_id: _Optional[str] = ..., as_attachment: _Optional[bool] = ...) -> None: ...

class GetPresignedDownloadUrlResponse(_message.Message):
    __slots__ = ("download_url", "expires_at")
    DOWNLOAD_URL_FIELD_NUMBER: _ClassVar[int]
    EXPIRES_AT_FIELD_NUMBER: _ClassVar[int]
    download_url: str
    expires_at: _timestamp_pb2.Timestamp
    def __init__(self, download_url: _Optional[str] = ..., expires_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class ListJobsRequest(_message.Message):
    __slots__ = ("page", "page_size", "query", "category")
    PAGE_FIELD_NUMBER: _ClassVar[int]
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    QUERY_FIELD_NUMBER: _ClassVar[int]
    CATEGORY_FIELD_NUMBER: _ClassVar[int]
    page: int
    page_size: int
    query: str
    category: str
    def __init__(self, page: _Optional[int] = ..., page_size: _Optional[int] = ..., query: _Optional[str] = ..., category: _Optional[str] = ...) -> None: ...

class ListJobsResponse(_message.Message):
    __slots__ = ("jobs", "total_count", "page", "page_size")
    JOBS_FIELD_NUMBER: _ClassVar[int]
    TOTAL_COUNT_FIELD_NUMBER: _ClassVar[int]
    PAGE_FIELD_NUMBER: _ClassVar[int]
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    jobs: _containers.RepeatedCompositeFieldContainer[Job]
    total_count: int
    page: int
    page_size: int
    def __init__(self, jobs: _Optional[_Iterable[_Union[Job, _Mapping]]] = ..., total_count: _Optional[int] = ..., page: _Optional[int] = ..., page_size: _Optional[int] = ...) -> None: ...

class DeleteJobRequest(_message.Message):
    __slots__ = ("job_id",)
    JOB_ID_FIELD_NUMBER: _ClassVar[int]
    job_id: str
    def __init__(self, job_id: _Optional[str] = ...) -> None: ...

class UpdateJobRequest(_message.Message):
    __slots__ = ("job_id", "title", "category")
    JOB_ID_FIELD_NUMBER: _ClassVar[int]
    TITLE_FIELD_NUMBER: _ClassVar[int]
    CATEGORY_FIELD_NUMBER: _ClassVar[int]
    job_id: str
    title: str
    category: str
    def __init__(self, job_id: _Optional[str] = ..., title: _Optional[str] = ..., category: _Optional[str] = ...) -> None: ...

class UpdateJobStatusRequest(_message.Message):
    __slots__ = ("job_id", "status", "error_reason")
    JOB_ID_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    ERROR_REASON_FIELD_NUMBER: _ClassVar[int]
    job_id: str
    status: JobStatus
    error_reason: str
    def __init__(self, job_id: _Optional[str] = ..., status: _Optional[_Union[JobStatus, str]] = ..., error_reason: _Optional[str] = ...) -> None: ...
