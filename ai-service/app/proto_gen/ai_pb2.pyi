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

class QuizStatus(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    QUIZ_STATUS_UNSPECIFIED: _ClassVar[QuizStatus]
    QUIZ_STATUS_GENERATING: _ClassVar[QuizStatus]
    QUIZ_STATUS_COMPLETED: _ClassVar[QuizStatus]
    QUIZ_STATUS_FAILED: _ClassVar[QuizStatus]

class ConnectionStatus(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    CONNECTION_STATUS_UNSPECIFIED: _ClassVar[ConnectionStatus]
    CONNECTION_STATUS_NOT_CONNECTED: _ClassVar[ConnectionStatus]
    CONNECTION_STATUS_CONNECTED: _ClassVar[ConnectionStatus]
    CONNECTION_STATUS_INVALID: _ClassVar[ConnectionStatus]

class TodoDestination(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    TODO_DESTINATION_UNSPECIFIED: _ClassVar[TodoDestination]
    TODO_DESTINATION_GOOGLE_TASKS: _ClassVar[TodoDestination]
    TODO_DESTINATION_NOTION: _ClassVar[TodoDestination]

class PostMeetingStatus(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    POST_MEETING_STATUS_UNSPECIFIED: _ClassVar[PostMeetingStatus]
    POST_MEETING_STATUS_RUNNING: _ClassVar[PostMeetingStatus]
    POST_MEETING_STATUS_COMPLETED: _ClassVar[PostMeetingStatus]
    POST_MEETING_STATUS_LIMIT_REACHED: _ClassVar[PostMeetingStatus]
    POST_MEETING_STATUS_FAILED: _ClassVar[PostMeetingStatus]

class ProposalStatus(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    PROPOSAL_STATUS_UNSPECIFIED: _ClassVar[ProposalStatus]
    PROPOSAL_STATUS_PROPOSED: _ClassVar[ProposalStatus]
    PROPOSAL_STATUS_DONE: _ClassVar[ProposalStatus]
    PROPOSAL_STATUS_FAILED: _ClassVar[ProposalStatus]
REGENERATION_STATUS_IDLE: RegenerationStatus
REGENERATION_STATUS_RUNNING: RegenerationStatus
REGENERATION_STATUS_FAILED: RegenerationStatus
QUIZ_STATUS_UNSPECIFIED: QuizStatus
QUIZ_STATUS_GENERATING: QuizStatus
QUIZ_STATUS_COMPLETED: QuizStatus
QUIZ_STATUS_FAILED: QuizStatus
CONNECTION_STATUS_UNSPECIFIED: ConnectionStatus
CONNECTION_STATUS_NOT_CONNECTED: ConnectionStatus
CONNECTION_STATUS_CONNECTED: ConnectionStatus
CONNECTION_STATUS_INVALID: ConnectionStatus
TODO_DESTINATION_UNSPECIFIED: TodoDestination
TODO_DESTINATION_GOOGLE_TASKS: TodoDestination
TODO_DESTINATION_NOTION: TodoDestination
POST_MEETING_STATUS_UNSPECIFIED: PostMeetingStatus
POST_MEETING_STATUS_RUNNING: PostMeetingStatus
POST_MEETING_STATUS_COMPLETED: PostMeetingStatus
POST_MEETING_STATUS_LIMIT_REACHED: PostMeetingStatus
POST_MEETING_STATUS_FAILED: PostMeetingStatus
PROPOSAL_STATUS_UNSPECIFIED: ProposalStatus
PROPOSAL_STATUS_PROPOSED: ProposalStatus
PROPOSAL_STATUS_DONE: ProposalStatus
PROPOSAL_STATUS_FAILED: ProposalStatus

class RequestQuizRequest(_message.Message):
    __slots__ = ("job_id", "user_id", "question_count")
    JOB_ID_FIELD_NUMBER: _ClassVar[int]
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    QUESTION_COUNT_FIELD_NUMBER: _ClassVar[int]
    job_id: str
    user_id: str
    question_count: int
    def __init__(self, job_id: _Optional[str] = ..., user_id: _Optional[str] = ..., question_count: _Optional[int] = ...) -> None: ...

class ListQuizzesRequest(_message.Message):
    __slots__ = ("job_id",)
    JOB_ID_FIELD_NUMBER: _ClassVar[int]
    job_id: str
    def __init__(self, job_id: _Optional[str] = ...) -> None: ...

class ListQuizzesResponse(_message.Message):
    __slots__ = ("quizzes",)
    QUIZZES_FIELD_NUMBER: _ClassVar[int]
    quizzes: _containers.RepeatedCompositeFieldContainer[Quiz]
    def __init__(self, quizzes: _Optional[_Iterable[_Union[Quiz, _Mapping]]] = ...) -> None: ...

class GetQuizRequest(_message.Message):
    __slots__ = ("job_id", "quiz_id")
    JOB_ID_FIELD_NUMBER: _ClassVar[int]
    QUIZ_ID_FIELD_NUMBER: _ClassVar[int]
    job_id: str
    quiz_id: str
    def __init__(self, job_id: _Optional[str] = ..., quiz_id: _Optional[str] = ...) -> None: ...

class Quiz(_message.Message):
    __slots__ = ("id", "job_id", "question_count", "status", "failure_reason", "source_revision", "model_provider", "model", "requested_at", "completed_at", "questions", "best_correct_count")
    ID_FIELD_NUMBER: _ClassVar[int]
    JOB_ID_FIELD_NUMBER: _ClassVar[int]
    QUESTION_COUNT_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    FAILURE_REASON_FIELD_NUMBER: _ClassVar[int]
    SOURCE_REVISION_FIELD_NUMBER: _ClassVar[int]
    MODEL_PROVIDER_FIELD_NUMBER: _ClassVar[int]
    MODEL_FIELD_NUMBER: _ClassVar[int]
    REQUESTED_AT_FIELD_NUMBER: _ClassVar[int]
    COMPLETED_AT_FIELD_NUMBER: _ClassVar[int]
    QUESTIONS_FIELD_NUMBER: _ClassVar[int]
    BEST_CORRECT_COUNT_FIELD_NUMBER: _ClassVar[int]
    id: str
    job_id: str
    question_count: int
    status: QuizStatus
    failure_reason: str
    source_revision: int
    model_provider: str
    model: str
    requested_at: _timestamp_pb2.Timestamp
    completed_at: _timestamp_pb2.Timestamp
    questions: _containers.RepeatedCompositeFieldContainer[QuizQuestion]
    best_correct_count: int
    def __init__(self, id: _Optional[str] = ..., job_id: _Optional[str] = ..., question_count: _Optional[int] = ..., status: _Optional[_Union[QuizStatus, str]] = ..., failure_reason: _Optional[str] = ..., source_revision: _Optional[int] = ..., model_provider: _Optional[str] = ..., model: _Optional[str] = ..., requested_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., completed_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., questions: _Optional[_Iterable[_Union[QuizQuestion, _Mapping]]] = ..., best_correct_count: _Optional[int] = ...) -> None: ...

class ListConnectionsRequest(_message.Message):
    __slots__ = ("user_id",)
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    user_id: str
    def __init__(self, user_id: _Optional[str] = ...) -> None: ...

class ListConnectionsResponse(_message.Message):
    __slots__ = ("connections",)
    CONNECTIONS_FIELD_NUMBER: _ClassVar[int]
    connections: _containers.RepeatedCompositeFieldContainer[Connection]
    def __init__(self, connections: _Optional[_Iterable[_Union[Connection, _Mapping]]] = ...) -> None: ...

class Connection(_message.Message):
    __slots__ = ("service", "status", "connected_at")
    SERVICE_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    CONNECTED_AT_FIELD_NUMBER: _ClassVar[int]
    service: str
    status: ConnectionStatus
    connected_at: _timestamp_pb2.Timestamp
    def __init__(self, service: _Optional[str] = ..., status: _Optional[_Union[ConnectionStatus, str]] = ..., connected_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class StartConnectionRequest(_message.Message):
    __slots__ = ("user_id", "service", "redirect_uri", "browser_binding")
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    SERVICE_FIELD_NUMBER: _ClassVar[int]
    REDIRECT_URI_FIELD_NUMBER: _ClassVar[int]
    BROWSER_BINDING_FIELD_NUMBER: _ClassVar[int]
    user_id: str
    service: str
    redirect_uri: str
    browser_binding: str
    def __init__(self, user_id: _Optional[str] = ..., service: _Optional[str] = ..., redirect_uri: _Optional[str] = ..., browser_binding: _Optional[str] = ...) -> None: ...

class StartConnectionResponse(_message.Message):
    __slots__ = ("authorize_url",)
    AUTHORIZE_URL_FIELD_NUMBER: _ClassVar[int]
    authorize_url: str
    def __init__(self, authorize_url: _Optional[str] = ...) -> None: ...

class CompleteConnectionRequest(_message.Message):
    __slots__ = ("service", "state", "code", "error", "browser_binding")
    SERVICE_FIELD_NUMBER: _ClassVar[int]
    STATE_FIELD_NUMBER: _ClassVar[int]
    CODE_FIELD_NUMBER: _ClassVar[int]
    ERROR_FIELD_NUMBER: _ClassVar[int]
    BROWSER_BINDING_FIELD_NUMBER: _ClassVar[int]
    service: str
    state: str
    code: str
    error: str
    browser_binding: str
    def __init__(self, service: _Optional[str] = ..., state: _Optional[str] = ..., code: _Optional[str] = ..., error: _Optional[str] = ..., browser_binding: _Optional[str] = ...) -> None: ...

class CompleteConnectionResponse(_message.Message):
    __slots__ = ("user_id",)
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    user_id: str
    def __init__(self, user_id: _Optional[str] = ...) -> None: ...

class DeleteConnectionRequest(_message.Message):
    __slots__ = ("user_id", "service")
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    SERVICE_FIELD_NUMBER: _ClassVar[int]
    user_id: str
    service: str
    def __init__(self, user_id: _Optional[str] = ..., service: _Optional[str] = ...) -> None: ...

class DeleteConnectionResponse(_message.Message):
    __slots__ = ("revoked",)
    REVOKED_FIELD_NUMBER: _ClassVar[int]
    revoked: bool
    def __init__(self, revoked: _Optional[bool] = ...) -> None: ...

class GetPostMeetingRequest(_message.Message):
    __slots__ = ("job_id", "user_id")
    JOB_ID_FIELD_NUMBER: _ClassVar[int]
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    job_id: str
    user_id: str
    def __init__(self, job_id: _Optional[str] = ..., user_id: _Optional[str] = ...) -> None: ...

class RequestPostMeetingRequest(_message.Message):
    __slots__ = ("job_id", "user_id", "timezone", "uploaded_at")
    JOB_ID_FIELD_NUMBER: _ClassVar[int]
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    TIMEZONE_FIELD_NUMBER: _ClassVar[int]
    UPLOADED_AT_FIELD_NUMBER: _ClassVar[int]
    job_id: str
    user_id: str
    timezone: str
    uploaded_at: _timestamp_pb2.Timestamp
    def __init__(self, job_id: _Optional[str] = ..., user_id: _Optional[str] = ..., timezone: _Optional[str] = ..., uploaded_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class PostMeeting(_message.Message):
    __slots__ = ("available", "unavailable_reason", "latest_run", "hints", "earlier_runs")
    AVAILABLE_FIELD_NUMBER: _ClassVar[int]
    UNAVAILABLE_REASON_FIELD_NUMBER: _ClassVar[int]
    LATEST_RUN_FIELD_NUMBER: _ClassVar[int]
    HINTS_FIELD_NUMBER: _ClassVar[int]
    EARLIER_RUNS_FIELD_NUMBER: _ClassVar[int]
    available: bool
    unavailable_reason: str
    latest_run: PostMeetingRun
    hints: _containers.RepeatedScalarFieldContainer[str]
    earlier_runs: _containers.RepeatedCompositeFieldContainer[PostMeetingRun]
    def __init__(self, available: _Optional[bool] = ..., unavailable_reason: _Optional[str] = ..., latest_run: _Optional[_Union[PostMeetingRun, _Mapping]] = ..., hints: _Optional[_Iterable[str]] = ..., earlier_runs: _Optional[_Iterable[_Union[PostMeetingRun, _Mapping]]] = ...) -> None: ...

class GetPostMeetingSettingsRequest(_message.Message):
    __slots__ = ("user_id",)
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    user_id: str
    def __init__(self, user_id: _Optional[str] = ...) -> None: ...

class UpdatePostMeetingSettingsRequest(_message.Message):
    __slots__ = ("user_id", "notion_meetings_page_url", "todo_destination")
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    NOTION_MEETINGS_PAGE_URL_FIELD_NUMBER: _ClassVar[int]
    TODO_DESTINATION_FIELD_NUMBER: _ClassVar[int]
    user_id: str
    notion_meetings_page_url: str
    todo_destination: TodoDestination
    def __init__(self, user_id: _Optional[str] = ..., notion_meetings_page_url: _Optional[str] = ..., todo_destination: _Optional[_Union[TodoDestination, str]] = ...) -> None: ...

class PostMeetingSettings(_message.Message):
    __slots__ = ("notion_meetings_page", "todo_destination")
    NOTION_MEETINGS_PAGE_FIELD_NUMBER: _ClassVar[int]
    TODO_DESTINATION_FIELD_NUMBER: _ClassVar[int]
    notion_meetings_page: NotionLocation
    todo_destination: TodoDestination
    def __init__(self, notion_meetings_page: _Optional[_Union[NotionLocation, _Mapping]] = ..., todo_destination: _Optional[_Union[TodoDestination, str]] = ...) -> None: ...

class NotionLocation(_message.Message):
    __slots__ = ("id", "title", "url")
    ID_FIELD_NUMBER: _ClassVar[int]
    TITLE_FIELD_NUMBER: _ClassVar[int]
    URL_FIELD_NUMBER: _ClassVar[int]
    id: str
    title: str
    url: str
    def __init__(self, id: _Optional[str] = ..., title: _Optional[str] = ..., url: _Optional[str] = ...) -> None: ...

class PostMeetingRun(_message.Message):
    __slots__ = ("id", "status", "progress", "failure_reason", "model_provider", "model", "requested_at", "finished_at", "proposals")
    ID_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    PROGRESS_FIELD_NUMBER: _ClassVar[int]
    FAILURE_REASON_FIELD_NUMBER: _ClassVar[int]
    MODEL_PROVIDER_FIELD_NUMBER: _ClassVar[int]
    MODEL_FIELD_NUMBER: _ClassVar[int]
    REQUESTED_AT_FIELD_NUMBER: _ClassVar[int]
    FINISHED_AT_FIELD_NUMBER: _ClassVar[int]
    PROPOSALS_FIELD_NUMBER: _ClassVar[int]
    id: str
    status: PostMeetingStatus
    progress: str
    failure_reason: str
    model_provider: str
    model: str
    requested_at: _timestamp_pb2.Timestamp
    finished_at: _timestamp_pb2.Timestamp
    proposals: _containers.RepeatedCompositeFieldContainer[ActionProposal]
    def __init__(self, id: _Optional[str] = ..., status: _Optional[_Union[PostMeetingStatus, str]] = ..., progress: _Optional[str] = ..., failure_reason: _Optional[str] = ..., model_provider: _Optional[str] = ..., model: _Optional[str] = ..., requested_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., finished_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., proposals: _Optional[_Iterable[_Union[ActionProposal, _Mapping]]] = ...) -> None: ...

class ExecuteProposalsRequest(_message.Message):
    __slots__ = ("job_id", "user_id", "run_id", "proposals")
    JOB_ID_FIELD_NUMBER: _ClassVar[int]
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    RUN_ID_FIELD_NUMBER: _ClassVar[int]
    PROPOSALS_FIELD_NUMBER: _ClassVar[int]
    job_id: str
    user_id: str
    run_id: str
    proposals: _containers.RepeatedCompositeFieldContainer[ProposalToExecute]
    def __init__(self, job_id: _Optional[str] = ..., user_id: _Optional[str] = ..., run_id: _Optional[str] = ..., proposals: _Optional[_Iterable[_Union[ProposalToExecute, _Mapping]]] = ...) -> None: ...

class ProposalToExecute(_message.Message):
    __slots__ = ("proposal_id", "arguments_json")
    PROPOSAL_ID_FIELD_NUMBER: _ClassVar[int]
    ARGUMENTS_JSON_FIELD_NUMBER: _ClassVar[int]
    proposal_id: str
    arguments_json: str
    def __init__(self, proposal_id: _Optional[str] = ..., arguments_json: _Optional[str] = ...) -> None: ...

class RetryProposalRequest(_message.Message):
    __slots__ = ("job_id", "user_id", "run_id", "proposal_id")
    JOB_ID_FIELD_NUMBER: _ClassVar[int]
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    RUN_ID_FIELD_NUMBER: _ClassVar[int]
    PROPOSAL_ID_FIELD_NUMBER: _ClassVar[int]
    job_id: str
    user_id: str
    run_id: str
    proposal_id: str
    def __init__(self, job_id: _Optional[str] = ..., user_id: _Optional[str] = ..., run_id: _Optional[str] = ..., proposal_id: _Optional[str] = ...) -> None: ...

class ActionProposal(_message.Message):
    __slots__ = ("id", "service", "kind", "arguments_json", "tool", "status", "result_url", "failure_reason", "previously_created")
    ID_FIELD_NUMBER: _ClassVar[int]
    SERVICE_FIELD_NUMBER: _ClassVar[int]
    KIND_FIELD_NUMBER: _ClassVar[int]
    ARGUMENTS_JSON_FIELD_NUMBER: _ClassVar[int]
    TOOL_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    RESULT_URL_FIELD_NUMBER: _ClassVar[int]
    FAILURE_REASON_FIELD_NUMBER: _ClassVar[int]
    PREVIOUSLY_CREATED_FIELD_NUMBER: _ClassVar[int]
    id: str
    service: str
    kind: str
    arguments_json: str
    tool: str
    status: ProposalStatus
    result_url: str
    failure_reason: str
    previously_created: bool
    def __init__(self, id: _Optional[str] = ..., service: _Optional[str] = ..., kind: _Optional[str] = ..., arguments_json: _Optional[str] = ..., tool: _Optional[str] = ..., status: _Optional[_Union[ProposalStatus, str]] = ..., result_url: _Optional[str] = ..., failure_reason: _Optional[str] = ..., previously_created: _Optional[bool] = ...) -> None: ...

class SubmitQuizAttemptRequest(_message.Message):
    __slots__ = ("job_id", "quiz_id", "user_id", "answers")
    JOB_ID_FIELD_NUMBER: _ClassVar[int]
    QUIZ_ID_FIELD_NUMBER: _ClassVar[int]
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    ANSWERS_FIELD_NUMBER: _ClassVar[int]
    job_id: str
    quiz_id: str
    user_id: str
    answers: _containers.RepeatedScalarFieldContainer[int]
    def __init__(self, job_id: _Optional[str] = ..., quiz_id: _Optional[str] = ..., user_id: _Optional[str] = ..., answers: _Optional[_Iterable[int]] = ...) -> None: ...

class QuizAttemptResult(_message.Message):
    __slots__ = ("correct_count", "question_count", "results")
    CORRECT_COUNT_FIELD_NUMBER: _ClassVar[int]
    QUESTION_COUNT_FIELD_NUMBER: _ClassVar[int]
    RESULTS_FIELD_NUMBER: _ClassVar[int]
    correct_count: int
    question_count: int
    results: _containers.RepeatedCompositeFieldContainer[QuizQuestionResult]
    def __init__(self, correct_count: _Optional[int] = ..., question_count: _Optional[int] = ..., results: _Optional[_Iterable[_Union[QuizQuestionResult, _Mapping]]] = ...) -> None: ...

class QuizQuestionResult(_message.Message):
    __slots__ = ("chosen_option", "correct_option", "correct", "explanation")
    CHOSEN_OPTION_FIELD_NUMBER: _ClassVar[int]
    CORRECT_OPTION_FIELD_NUMBER: _ClassVar[int]
    CORRECT_FIELD_NUMBER: _ClassVar[int]
    EXPLANATION_FIELD_NUMBER: _ClassVar[int]
    chosen_option: int
    correct_option: int
    correct: bool
    explanation: str
    def __init__(self, chosen_option: _Optional[int] = ..., correct_option: _Optional[int] = ..., correct: _Optional[bool] = ..., explanation: _Optional[str] = ...) -> None: ...

class QuizQuestion(_message.Message):
    __slots__ = ("kind", "prompt", "options", "correct_option", "explanation", "source_timestamps")
    KIND_FIELD_NUMBER: _ClassVar[int]
    PROMPT_FIELD_NUMBER: _ClassVar[int]
    OPTIONS_FIELD_NUMBER: _ClassVar[int]
    CORRECT_OPTION_FIELD_NUMBER: _ClassVar[int]
    EXPLANATION_FIELD_NUMBER: _ClassVar[int]
    SOURCE_TIMESTAMPS_FIELD_NUMBER: _ClassVar[int]
    kind: str
    prompt: str
    options: _containers.RepeatedScalarFieldContainer[str]
    correct_option: int
    explanation: str
    source_timestamps: _containers.RepeatedScalarFieldContainer[float]
    def __init__(self, kind: _Optional[str] = ..., prompt: _Optional[str] = ..., options: _Optional[_Iterable[str]] = ..., correct_option: _Optional[int] = ..., explanation: _Optional[str] = ..., source_timestamps: _Optional[_Iterable[float]] = ...) -> None: ...

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

class SumUserLlmUsageRequest(_message.Message):
    __slots__ = ("user_id", "start", "end")
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    START_FIELD_NUMBER: _ClassVar[int]
    END_FIELD_NUMBER: _ClassVar[int]
    user_id: str
    start: _timestamp_pb2.Timestamp
    end: _timestamp_pb2.Timestamp
    def __init__(self, user_id: _Optional[str] = ..., start: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., end: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class SumUserLlmUsageResponse(_message.Message):
    __slots__ = ("sums",)
    SUMS_FIELD_NUMBER: _ClassVar[int]
    sums: _containers.RepeatedCompositeFieldContainer[LlmUsageSum]
    def __init__(self, sums: _Optional[_Iterable[_Union[LlmUsageSum, _Mapping]]] = ...) -> None: ...

class LlmUsageSum(_message.Message):
    __slots__ = ("provider", "model", "key_source", "input_tokens", "output_tokens", "calls", "calls_with_unknown_usage")
    PROVIDER_FIELD_NUMBER: _ClassVar[int]
    MODEL_FIELD_NUMBER: _ClassVar[int]
    KEY_SOURCE_FIELD_NUMBER: _ClassVar[int]
    INPUT_TOKENS_FIELD_NUMBER: _ClassVar[int]
    OUTPUT_TOKENS_FIELD_NUMBER: _ClassVar[int]
    CALLS_FIELD_NUMBER: _ClassVar[int]
    CALLS_WITH_UNKNOWN_USAGE_FIELD_NUMBER: _ClassVar[int]
    provider: str
    model: str
    key_source: str
    input_tokens: int
    output_tokens: int
    calls: int
    calls_with_unknown_usage: int
    def __init__(self, provider: _Optional[str] = ..., model: _Optional[str] = ..., key_source: _Optional[str] = ..., input_tokens: _Optional[int] = ..., output_tokens: _Optional[int] = ..., calls: _Optional[int] = ..., calls_with_unknown_usage: _Optional[int] = ...) -> None: ...

class ListJobWebSearchesRequest(_message.Message):
    __slots__ = ("job_id",)
    JOB_ID_FIELD_NUMBER: _ClassVar[int]
    job_id: str
    def __init__(self, job_id: _Optional[str] = ...) -> None: ...

class ListJobWebSearchesResponse(_message.Message):
    __slots__ = ("records",)
    RECORDS_FIELD_NUMBER: _ClassVar[int]
    records: _containers.RepeatedCompositeFieldContainer[WebSearchUsage]
    def __init__(self, records: _Optional[_Iterable[_Union[WebSearchUsage, _Mapping]]] = ...) -> None: ...

class WebSearchUsage(_message.Message):
    __slots__ = ("provider", "succeeded", "created_at")
    PROVIDER_FIELD_NUMBER: _ClassVar[int]
    SUCCEEDED_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    provider: str
    succeeded: bool
    created_at: _timestamp_pb2.Timestamp
    def __init__(self, provider: _Optional[str] = ..., succeeded: _Optional[bool] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class CountUserWebSearchesRequest(_message.Message):
    __slots__ = ("user_id", "start", "end")
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    START_FIELD_NUMBER: _ClassVar[int]
    END_FIELD_NUMBER: _ClassVar[int]
    user_id: str
    start: _timestamp_pb2.Timestamp
    end: _timestamp_pb2.Timestamp
    def __init__(self, user_id: _Optional[str] = ..., start: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., end: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class CountUserWebSearchesResponse(_message.Message):
    __slots__ = ("succeeded", "failed")
    SUCCEEDED_FIELD_NUMBER: _ClassVar[int]
    FAILED_FIELD_NUMBER: _ClassVar[int]
    succeeded: int
    failed: int
    def __init__(self, succeeded: _Optional[int] = ..., failed: _Optional[int] = ...) -> None: ...

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
    __slots__ = ("job_id", "summary_text", "source_revision", "regeneration_status", "model_provider", "model")
    JOB_ID_FIELD_NUMBER: _ClassVar[int]
    SUMMARY_TEXT_FIELD_NUMBER: _ClassVar[int]
    SOURCE_REVISION_FIELD_NUMBER: _ClassVar[int]
    REGENERATION_STATUS_FIELD_NUMBER: _ClassVar[int]
    MODEL_PROVIDER_FIELD_NUMBER: _ClassVar[int]
    MODEL_FIELD_NUMBER: _ClassVar[int]
    job_id: str
    summary_text: str
    source_revision: int
    regeneration_status: RegenerationStatus
    model_provider: str
    model: str
    def __init__(self, job_id: _Optional[str] = ..., summary_text: _Optional[str] = ..., source_revision: _Optional[int] = ..., regeneration_status: _Optional[_Union[RegenerationStatus, str]] = ..., model_provider: _Optional[str] = ..., model: _Optional[str] = ...) -> None: ...

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
    __slots__ = ("job_id", "user_id", "question", "model", "web_search")
    JOB_ID_FIELD_NUMBER: _ClassVar[int]
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    QUESTION_FIELD_NUMBER: _ClassVar[int]
    MODEL_FIELD_NUMBER: _ClassVar[int]
    WEB_SEARCH_FIELD_NUMBER: _ClassVar[int]
    job_id: str
    user_id: str
    question: str
    model: ModelChoice
    web_search: bool
    def __init__(self, job_id: _Optional[str] = ..., user_id: _Optional[str] = ..., question: _Optional[str] = ..., model: _Optional[_Union[ModelChoice, _Mapping]] = ..., web_search: _Optional[bool] = ...) -> None: ...

class AskQuestionChunk(_message.Message):
    __slots__ = ("sources", "delta", "error", "answered_by", "web_sources")
    SOURCES_FIELD_NUMBER: _ClassVar[int]
    DELTA_FIELD_NUMBER: _ClassVar[int]
    ERROR_FIELD_NUMBER: _ClassVar[int]
    ANSWERED_BY_FIELD_NUMBER: _ClassVar[int]
    WEB_SOURCES_FIELD_NUMBER: _ClassVar[int]
    sources: SourceTimestamps
    delta: str
    error: str
    answered_by: ModelChoice
    web_sources: WebSources
    def __init__(self, sources: _Optional[_Union[SourceTimestamps, _Mapping]] = ..., delta: _Optional[str] = ..., error: _Optional[str] = ..., answered_by: _Optional[_Union[ModelChoice, _Mapping]] = ..., web_sources: _Optional[_Union[WebSources, _Mapping]] = ...) -> None: ...

class WebSource(_message.Message):
    __slots__ = ("title", "url")
    TITLE_FIELD_NUMBER: _ClassVar[int]
    URL_FIELD_NUMBER: _ClassVar[int]
    title: str
    url: str
    def __init__(self, title: _Optional[str] = ..., url: _Optional[str] = ...) -> None: ...

class WebSources(_message.Message):
    __slots__ = ("sources", "failed")
    SOURCES_FIELD_NUMBER: _ClassVar[int]
    FAILED_FIELD_NUMBER: _ClassVar[int]
    sources: _containers.RepeatedCompositeFieldContainer[WebSource]
    failed: bool
    def __init__(self, sources: _Optional[_Iterable[_Union[WebSource, _Mapping]]] = ..., failed: _Optional[bool] = ...) -> None: ...

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
    __slots__ = ("question", "answer", "source_timestamps", "created_at", "model_provider", "model", "web_search", "web_sources")
    QUESTION_FIELD_NUMBER: _ClassVar[int]
    ANSWER_FIELD_NUMBER: _ClassVar[int]
    SOURCE_TIMESTAMPS_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    MODEL_PROVIDER_FIELD_NUMBER: _ClassVar[int]
    MODEL_FIELD_NUMBER: _ClassVar[int]
    WEB_SEARCH_FIELD_NUMBER: _ClassVar[int]
    WEB_SOURCES_FIELD_NUMBER: _ClassVar[int]
    question: str
    answer: str
    source_timestamps: _containers.RepeatedScalarFieldContainer[float]
    created_at: _timestamp_pb2.Timestamp
    model_provider: str
    model: str
    web_search: bool
    web_sources: _containers.RepeatedCompositeFieldContainer[WebSource]
    def __init__(self, question: _Optional[str] = ..., answer: _Optional[str] = ..., source_timestamps: _Optional[_Iterable[float]] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., model_provider: _Optional[str] = ..., model: _Optional[str] = ..., web_search: _Optional[bool] = ..., web_sources: _Optional[_Iterable[_Union[WebSource, _Mapping]]] = ...) -> None: ...

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
    __slots__ = ("deleted", "default_model_reset")
    DELETED_FIELD_NUMBER: _ClassVar[int]
    DEFAULT_MODEL_RESET_FIELD_NUMBER: _ClassVar[int]
    deleted: bool
    default_model_reset: bool
    def __init__(self, deleted: _Optional[bool] = ..., default_model_reset: _Optional[bool] = ...) -> None: ...

class ListAvailableModelsRequest(_message.Message):
    __slots__ = ("user_id",)
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    user_id: str
    def __init__(self, user_id: _Optional[str] = ...) -> None: ...

class ListAvailableModelsResponse(_message.Message):
    __slots__ = ("models", "openrouter_custom", "web_search")
    MODELS_FIELD_NUMBER: _ClassVar[int]
    OPENROUTER_CUSTOM_FIELD_NUMBER: _ClassVar[int]
    WEB_SEARCH_FIELD_NUMBER: _ClassVar[int]
    models: _containers.RepeatedCompositeFieldContainer[ModelChoice]
    openrouter_custom: bool
    web_search: bool
    def __init__(self, models: _Optional[_Iterable[_Union[ModelChoice, _Mapping]]] = ..., openrouter_custom: _Optional[bool] = ..., web_search: _Optional[bool] = ...) -> None: ...

class ModelChoice(_message.Message):
    __slots__ = ("provider", "model", "supports_tools")
    PROVIDER_FIELD_NUMBER: _ClassVar[int]
    MODEL_FIELD_NUMBER: _ClassVar[int]
    SUPPORTS_TOOLS_FIELD_NUMBER: _ClassVar[int]
    provider: str
    model: str
    supports_tools: bool
    def __init__(self, provider: _Optional[str] = ..., model: _Optional[str] = ..., supports_tools: _Optional[bool] = ...) -> None: ...

class GetDefaultModelRequest(_message.Message):
    __slots__ = ("user_id",)
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    user_id: str
    def __init__(self, user_id: _Optional[str] = ...) -> None: ...

class SetDefaultModelRequest(_message.Message):
    __slots__ = ("user_id", "provider", "model")
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    PROVIDER_FIELD_NUMBER: _ClassVar[int]
    MODEL_FIELD_NUMBER: _ClassVar[int]
    user_id: str
    provider: str
    model: str
    def __init__(self, user_id: _Optional[str] = ..., provider: _Optional[str] = ..., model: _Optional[str] = ...) -> None: ...

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
