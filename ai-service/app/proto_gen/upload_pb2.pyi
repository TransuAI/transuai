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

class Job(_message.Message):
    __slots__ = ("job_id", "user_id", "file_name", "file_type", "file_size_bytes", "storage_path", "duration_seconds", "status", "error_reason", "created_at", "updated_at")
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
    def __init__(self, job_id: _Optional[str] = ..., user_id: _Optional[str] = ..., file_name: _Optional[str] = ..., file_type: _Optional[_Union[FileType, str]] = ..., file_size_bytes: _Optional[int] = ..., storage_path: _Optional[str] = ..., duration_seconds: _Optional[int] = ..., status: _Optional[_Union[JobStatus, str]] = ..., error_reason: _Optional[str] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., updated_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

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
    __slots__ = ("storage_path", "file_name", "file_type", "file_size_bytes", "duration_seconds")
    STORAGE_PATH_FIELD_NUMBER: _ClassVar[int]
    FILE_NAME_FIELD_NUMBER: _ClassVar[int]
    FILE_TYPE_FIELD_NUMBER: _ClassVar[int]
    FILE_SIZE_BYTES_FIELD_NUMBER: _ClassVar[int]
    DURATION_SECONDS_FIELD_NUMBER: _ClassVar[int]
    storage_path: str
    file_name: str
    file_type: FileType
    file_size_bytes: int
    duration_seconds: int
    def __init__(self, storage_path: _Optional[str] = ..., file_name: _Optional[str] = ..., file_type: _Optional[_Union[FileType, str]] = ..., file_size_bytes: _Optional[int] = ..., duration_seconds: _Optional[int] = ...) -> None: ...

class GetJobRequest(_message.Message):
    __slots__ = ("job_id",)
    JOB_ID_FIELD_NUMBER: _ClassVar[int]
    job_id: str
    def __init__(self, job_id: _Optional[str] = ...) -> None: ...

class ListJobsRequest(_message.Message):
    __slots__ = ("page", "page_size")
    PAGE_FIELD_NUMBER: _ClassVar[int]
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    page: int
    page_size: int
    def __init__(self, page: _Optional[int] = ..., page_size: _Optional[int] = ...) -> None: ...

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

class UpdateJobStatusRequest(_message.Message):
    __slots__ = ("job_id", "status", "error_reason")
    JOB_ID_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    ERROR_REASON_FIELD_NUMBER: _ClassVar[int]
    job_id: str
    status: JobStatus
    error_reason: str
    def __init__(self, job_id: _Optional[str] = ..., status: _Optional[_Union[JobStatus, str]] = ..., error_reason: _Optional[str] = ...) -> None: ...
