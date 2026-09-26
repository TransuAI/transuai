import logging
import uuid
from collections.abc import Sequence
from datetime import timezone
from typing import NoReturn

import grpc
from google.protobuf import timestamp_pb2

from app.db import new_session
from app.proto_gen import ai_pb2, ai_pb2_grpc
from app.repositories.chapter_repository import find_by_job_id as find_chapters_by_job_id
from app.repositories.llm_usage_repository import list_job_llm_usage, sum_user_llm_usage
from app.repositories.provider_key_repository import list_provider_keys
from app.repositories.qa_repository import find_by_job_id as find_qa_history_by_job_id
from app.repositories.qa_repository import save_qa
from app.repositories.quiz_repository import best_correct_counts, find_quiz, list_questions, list_quizzes
from app.repositories.summary_repository import find_by_job_id as find_summary_by_job_id
from app.services.connections import (
    AuthorizationFailed,
    InvalidBrowserBinding,
    ServiceNotConfigured,
    ServiceUnreachable,
    UnknownAuthorization,
    UnknownService,
    complete_connection,
    disconnect,
    list_connections,
    start_connection,
)
from app.services.default_models import (
    ModelNotAvailable,
    NoProviderKey,
    available_models,
    get_default_model,
    remove_provider_key,
    set_default_model,
)
from app.services.key_encryption import EncryptionUnavailable
from app.services.llm_client import LlmError
from app.services.model_catalog import CatalogUnreachable, ModelChoice, UnknownModel
from app.services.provider_keys import InvalidKey, ProviderUnreachable, UnknownProvider, save_provider_key
from app.services.qa import NoEmbeddingsError, stream_answer
from app.services.quizzes import (
    InvalidAnswers,
    InvalidQuestionCount,
    QuizNotFound,
    QuizNotQueued,
    QuizNotReady,
    effective_status,
    request_quiz,
    submit_attempt,
)
from app.models import ConnectionStatus, Quiz, QuizQuestion, QuizStatus, RegenerationStatus
from app.services.regeneration import (
    RegenerationNotQueued,
    SummaryNotFound,
    effective_regeneration_status,
    request_regeneration,
)

logger = logging.getLogger(__name__)

_STREAM_ERROR_MESSAGE = "回答時發生錯誤，請稍後再試"


def _stream_error_message(exc: Exception) -> str:
    """模型呼叫失敗時告訴使用者是哪個廠商、什麼原因（例如自有金鑰額度不足），其他錯誤用通用訊息。"""
    return str(exc) if isinstance(exc, LlmError) else _STREAM_ERROR_MESSAGE


def _abort(context: grpc.ServicerContext, code: grpc.StatusCode, message: str) -> NoReturn:
    context.abort(code, message)
    raise AssertionError("unreachable")  # context.abort() 保證會 raise 中斷 RPC


_REGENERATION_STATUSES = {
    RegenerationStatus.IDLE: ai_pb2.REGENERATION_STATUS_IDLE,
    RegenerationStatus.RUNNING: ai_pb2.REGENERATION_STATUS_RUNNING,
    RegenerationStatus.FAILED: ai_pb2.REGENERATION_STATUS_FAILED,
}


def _summary_to_proto(summary) -> ai_pb2.Summary:
    return ai_pb2.Summary(
        job_id=str(summary.job_id),
        summary_text=summary.summary_text or "",
        source_revision=summary.source_revision,
        regeneration_status=_REGENERATION_STATUSES[effective_regeneration_status(summary)],
        model_provider=summary.model_provider or "",
        model=summary.model or "",
    )


class AiController(ai_pb2_grpc.AiServiceServicer):
    def GetSummary(self, request, context):
        try:
            job_id = uuid.UUID(request.job_id)
        except ValueError:
            _abort(context, grpc.StatusCode.INVALID_ARGUMENT, "job_id must be a valid UUID")

        session = new_session()
        try:
            summary = find_summary_by_job_id(session, job_id)
            if summary is None:
                _abort(context, grpc.StatusCode.NOT_FOUND, "summary not found")

            return _summary_to_proto(summary)
        finally:
            session.close()

    def ListChapters(self, request, context):
        try:
            job_id = uuid.UUID(request.job_id)
        except ValueError:
            _abort(context, grpc.StatusCode.INVALID_ARGUMENT, "job_id must be a valid UUID")

        session = new_session()
        try:
            chapters = find_chapters_by_job_id(session, job_id)
            return ai_pb2.ListChaptersResponse(
                chapters=[
                    ai_pb2.Chapter(
                        id=str(chapter.id),
                        job_id=str(chapter.job_id),
                        title=chapter.title,
                        start_time=float(chapter.start_time),
                        sequence_no=chapter.sequence_no,
                    )
                    for chapter in chapters
                ]
            )
        finally:
            session.close()

    def AskQuestion(self, request, context):
        try:
            job_id = uuid.UUID(request.job_id)
        except ValueError:
            _abort(context, grpc.StatusCode.INVALID_ARGUMENT, "job_id must be a valid UUID")
        try:
            user_id = uuid.UUID(request.user_id)
        except ValueError:
            _abort(context, grpc.StatusCode.INVALID_ARGUMENT, "user_id must be a valid UUID")

        question = request.question.strip()
        if not question:
            _abort(context, grpc.StatusCode.INVALID_ARGUMENT, "question must not be empty")

        requested_model = (request.model.provider, request.model.model) if request.HasField("model") else None

        session = new_session()
        try:
            chunks = stream_answer(session, job_id, question, user_id=user_id, requested_model=requested_model)

            # 第一個 yield 保證是 sources（見 qa.stream_answer），在這之前發生的任何錯誤都還
            # 沒有送出任何 chunk：NoEmbeddingsError 是結構性的（這個 job 現在就是沒有 embedding），
            # 維持跟之前一樣的 NOT_FOUND abort；其他例外（改寫/檢索呼叫失敗）視為這輪問答本身
            # 失敗，改用 error chunk 讓 stream 正常結束，不寫 qa_history。
            try:
                kind, source_timestamps = next(chunks)
            except NoEmbeddingsError:
                _abort(context, grpc.StatusCode.NOT_FOUND,
                       "no transcript content available for this job yet")
            except ModelNotAvailable as exc:
                _abort(context, grpc.StatusCode.INVALID_ARGUMENT, str(exc))
            except Exception as exc:
                logger.exception("failed to prepare answer for job %s", job_id)
                yield ai_pb2.AskQuestionChunk(error=_stream_error_message(exc))
                return
            assert kind == "sources"
            yield ai_pb2.AskQuestionChunk(
                sources=ai_pb2.SourceTimestamps(source_timestamps=source_timestamps))

            answer_parts: list[str] = []
            answered_by: tuple[str, str] = ("", "")
            try:
                for kind, payload in chunks:
                    if kind == "answered_by":
                        answered_by = payload  # type: ignore[assignment]
                        yield ai_pb2.AskQuestionChunk(
                            answered_by=ai_pb2.ModelChoice(provider=answered_by[0], model=answered_by[1]))
                        continue
                    answer_parts.append(payload)  # type: ignore[arg-type]
                    yield ai_pb2.AskQuestionChunk(delta=payload)  # type: ignore[arg-type]
            except Exception as exc:
                logger.exception("answer streaming failed mid-flight for job %s", job_id)
                yield ai_pb2.AskQuestionChunk(error=_stream_error_message(exc))
                return

            save_qa(session, job_id, user_id, question, "".join(answer_parts), source_timestamps, model=answered_by)
        finally:
            session.close()

    def ListQaHistory(self, request, context):
        try:
            job_id = uuid.UUID(request.job_id)
        except ValueError:
            _abort(context, grpc.StatusCode.INVALID_ARGUMENT, "job_id must be a valid UUID")

        session = new_session()
        try:
            turns = []
            for turn in find_qa_history_by_job_id(session, job_id):
                created_at = timestamp_pb2.Timestamp()
                created_at.FromDatetime(turn.created_at)
                turns.append(ai_pb2.QaTurn(
                    question=turn.question,
                    answer=turn.answer,
                    source_timestamps=[float(t) for t in turn.source_timestamps],
                    created_at=created_at,
                    model_provider=turn.model_provider or "",
                    model=turn.model or "",
                ))
            return ai_pb2.ListQaHistoryResponse(turns=turns)
        finally:
            session.close()

    def RequestRegeneration(self, request, context):
        try:
            job_id = uuid.UUID(request.job_id)
        except ValueError:
            _abort(context, grpc.StatusCode.INVALID_ARGUMENT, "job_id must be a valid UUID")
        # 升級前的 Gateway 不帶 user_id：照樣排入，用量不記使用者。
        try:
            user_id = uuid.UUID(request.user_id) if request.user_id else None
        except ValueError:
            _abort(context, grpc.StatusCode.INVALID_ARGUMENT, "user_id must be a valid UUID")
        try:
            summary = request_regeneration(job_id, user_id)
        except SummaryNotFound:
            _abort(context, grpc.StatusCode.NOT_FOUND, "summary not found")
        except RegenerationNotQueued:
            _abort(context, grpc.StatusCode.UNAVAILABLE, "could not queue the regeneration, try again")
        return _summary_to_proto(summary)

    def ListJobLlmUsage(self, request, context):
        try:
            job_id = uuid.UUID(request.job_id)
        except ValueError:
            _abort(context, grpc.StatusCode.INVALID_ARGUMENT, "job_id must be a valid UUID")

        session = new_session()
        try:
            return ai_pb2.ListJobLlmUsageResponse(
                records=[_llm_usage_to_proto(usage) for usage in list_job_llm_usage(session, job_id)])
        finally:
            session.close()

    def SumUserLlmUsage(self, request, context):
        user_id = _parse_user_id(request.user_id, context)
        if not (request.HasField("start") and request.HasField("end")):
            _abort(context, grpc.StatusCode.INVALID_ARGUMENT, "start and end are required")

        session = new_session()
        try:
            sums = sum_user_llm_usage(session, user_id, request.start.ToDatetime(timezone.utc),
                                      request.end.ToDatetime(timezone.utc))
        finally:
            session.close()
        return ai_pb2.SumUserLlmUsageResponse(sums=[
            ai_pb2.LlmUsageSum(provider=s.provider, model=s.model, key_source=s.key_source, input_tokens=s.input_tokens,
                               output_tokens=s.output_tokens, calls=s.calls,
                               calls_with_unknown_usage=s.calls_with_unknown_usage)
            for s in sums])

    def SaveProviderKey(self, request, context):
        user_id = _parse_user_id(request.user_id, context)
        try:
            key = save_provider_key(user_id, request.provider, request.key)
        except UnknownProvider:
            _abort(context, grpc.StatusCode.INVALID_ARGUMENT, f"不支援的廠商：{request.provider}")
        except InvalidKey as exc:
            _abort(context, grpc.StatusCode.INVALID_ARGUMENT, str(exc))
        except ProviderUnreachable as exc:
            _abort(context, grpc.StatusCode.UNAVAILABLE, str(exc))
        except EncryptionUnavailable:
            logger.error("cannot save provider keys: KEY_ENCRYPTION_KEY is missing or invalid")
            _abort(context, grpc.StatusCode.FAILED_PRECONDITION, "伺服器沒有設定加密金鑰，暫時不能存入自有金鑰")
        return _provider_key_to_proto(key)

    def DeleteProviderKey(self, request, context):
        user_id = _parse_user_id(request.user_id, context)
        deleted, reset = remove_provider_key(user_id, request.provider)
        return ai_pb2.DeleteProviderKeyResponse(deleted=deleted, default_model_reset=reset)

    def ListAvailableModels(self, request, context):
        user_id = _parse_user_id(request.user_id, context)
        models, openrouter_custom = available_models(user_id)
        return ai_pb2.ListAvailableModelsResponse(
            models=[_model_choice_to_proto(model) for model in models], openrouter_custom=openrouter_custom)

    def GetDefaultModel(self, request, context):
        return _model_choice_to_proto(get_default_model(_parse_user_id(request.user_id, context)))

    def SetDefaultModel(self, request, context):
        user_id = _parse_user_id(request.user_id, context)
        try:
            choice = set_default_model(user_id, request.provider, request.model)
        except NoProviderKey:
            _abort(context, grpc.StatusCode.FAILED_PRECONDITION, f"還沒有存入 {request.provider} 的自有金鑰")
        except UnknownModel as exc:
            _abort(context, grpc.StatusCode.INVALID_ARGUMENT, str(exc))
        except CatalogUnreachable as exc:
            _abort(context, grpc.StatusCode.UNAVAILABLE, str(exc))
        return _model_choice_to_proto(choice)

    def ListProviderKeys(self, request, context):
        user_id = _parse_user_id(request.user_id, context)
        session = new_session()
        try:
            return ai_pb2.ListProviderKeysResponse(
                keys=[_provider_key_to_proto(key) for key in list_provider_keys(session, user_id)])
        finally:
            session.close()

    def RequestQuiz(self, request, context):
        job_id = _parse_uuid(request.job_id, "job_id", context)
        user_id = _parse_user_id(request.user_id, context)
        try:
            quiz = request_quiz(job_id, user_id, request.question_count)
        except InvalidQuestionCount:
            _abort(context, grpc.StatusCode.INVALID_ARGUMENT, "題數只能是 5、10 或 20")
        except QuizNotQueued:
            _abort(context, grpc.StatusCode.UNAVAILABLE, "暫時無法產生測驗，請稍後再試")
        return _quiz_to_proto(quiz)

    def ListQuizzes(self, request, context):
        job_id = _parse_uuid(request.job_id, "job_id", context)
        session = new_session()
        try:
            quizzes = list_quizzes(session, job_id)
            best = best_correct_counts(session, [quiz.id for quiz in quizzes])
            return ai_pb2.ListQuizzesResponse(quizzes=[_quiz_to_proto(quiz, best=best.get(quiz.id)) for quiz in quizzes])
        finally:
            session.close()

    def GetQuiz(self, request, context):
        job_id = _parse_uuid(request.job_id, "job_id", context)
        quiz_id = _parse_uuid(request.quiz_id, "quiz_id", context)
        session = new_session()
        try:
            quiz = find_quiz(session, job_id, quiz_id)
            if quiz is None:
                _abort(context, grpc.StatusCode.NOT_FOUND, "quiz not found")
            return _quiz_to_proto(quiz, list_questions(session, quiz_id),
                                  best=best_correct_counts(session, [quiz_id]).get(quiz_id))
        finally:
            session.close()

    def SubmitQuizAttempt(self, request, context):
        job_id = _parse_uuid(request.job_id, "job_id", context)
        quiz_id = _parse_uuid(request.quiz_id, "quiz_id", context)
        user_id = _parse_user_id(request.user_id, context)
        try:
            result = submit_attempt(job_id, quiz_id, user_id, list(request.answers))
        except QuizNotFound:
            _abort(context, grpc.StatusCode.NOT_FOUND, "quiz not found")
        except QuizNotReady:
            _abort(context, grpc.StatusCode.FAILED_PRECONDITION, "這份測驗還沒產生完成")
        except InvalidAnswers:
            _abort(context, grpc.StatusCode.INVALID_ARGUMENT, "每一題都要選一個選項")
        return ai_pb2.QuizAttemptResult(
            correct_count=result.correct_count, question_count=len(result.results),
            results=[ai_pb2.QuizQuestionResult(chosen_option=r.chosen_option, correct_option=r.correct_option,
                                               correct=r.correct, explanation=r.explanation)
                     for r in result.results])


    def ListConnections(self, request, context):
        user_id = _parse_user_id(request.user_id, context)
        connections = []
        for state in list_connections(user_id):
            connection = ai_pb2.Connection(service=state.service, status=_CONNECTION_STATUS[state.status])
            if state.connected_at is not None:
                connection.connected_at.FromDatetime(state.connected_at)
            connections.append(connection)
        return ai_pb2.ListConnectionsResponse(connections=connections)

    def StartConnection(self, request, context):
        user_id = _parse_user_id(request.user_id, context)
        try:
            url = start_connection(user_id, request.service, request.redirect_uri, request.browser_binding)
        except UnknownService:
            _abort(context, grpc.StatusCode.INVALID_ARGUMENT, f"不支援的服務：{request.service}")
        except InvalidBrowserBinding:
            _abort(context, grpc.StatusCode.INVALID_ARGUMENT, "browser_binding is required")
        except ServiceNotConfigured as exc:
            _abort(context, grpc.StatusCode.FAILED_PRECONDITION, str(exc))
        except ServiceUnreachable as exc:
            _abort(context, grpc.StatusCode.UNAVAILABLE, str(exc))
        return ai_pb2.StartConnectionResponse(authorize_url=url)

    def CompleteConnection(self, request, context):
        try:
            user_id = complete_connection(request.service, request.state, request.code, request.error,
                                          request.browser_binding)
        except (UnknownService, UnknownAuthorization):
            _abort(context, grpc.StatusCode.INVALID_ARGUMENT, "這次授權不存在或已經過期，請再連結一次")
        except AuthorizationFailed as exc:
            _abort(context, grpc.StatusCode.FAILED_PRECONDITION, str(exc))
        except ServiceUnreachable as exc:
            _abort(context, grpc.StatusCode.UNAVAILABLE, str(exc))
        return ai_pb2.CompleteConnectionResponse(user_id=str(user_id))

    def DeleteConnection(self, request, context):
        user_id = _parse_user_id(request.user_id, context)
        try:
            revoked = disconnect(user_id, request.service)
        except UnknownService:
            _abort(context, grpc.StatusCode.INVALID_ARGUMENT, f"不支援的服務：{request.service}")
        return ai_pb2.DeleteConnectionResponse(revoked=revoked)


_CONNECTION_STATUS = {
    None: ai_pb2.CONNECTION_STATUS_NOT_CONNECTED,
    ConnectionStatus.CONNECTED: ai_pb2.CONNECTION_STATUS_CONNECTED,
    ConnectionStatus.INVALID: ai_pb2.CONNECTION_STATUS_INVALID,
}


def _parse_uuid(value: str, field: str, context: grpc.ServicerContext) -> uuid.UUID:
    try:
        return uuid.UUID(value)
    except ValueError:
        _abort(context, grpc.StatusCode.INVALID_ARGUMENT, f"{field} must be a valid UUID")


_QUIZ_STATUS = {
    QuizStatus.GENERATING: ai_pb2.QUIZ_STATUS_GENERATING,
    QuizStatus.COMPLETED: ai_pb2.QUIZ_STATUS_COMPLETED,
    QuizStatus.FAILED: ai_pb2.QUIZ_STATUS_FAILED,
}


def _quiz_to_proto(quiz: Quiz, questions: Sequence[QuizQuestion] = (), *, best: int | None = None) -> ai_pb2.Quiz:
    status, failure_reason = effective_status(quiz)
    message = ai_pb2.Quiz(
        id=str(quiz.id), job_id=str(quiz.job_id), question_count=quiz.question_count,
        status=_QUIZ_STATUS[status], failure_reason=failure_reason or "",
        source_revision=quiz.source_revision or 0, model_provider=quiz.model_provider or "", model=quiz.model or "",
        questions=[ai_pb2.QuizQuestion(
            kind=q.kind, prompt=q.prompt, options=q.options, correct_option=q.correct_option,
            explanation=q.explanation, source_timestamps=q.source_timestamps) for q in questions])
    message.requested_at.FromDatetime(quiz.requested_at)
    if quiz.completed_at is not None:
        message.completed_at.FromDatetime(quiz.completed_at)
    if best is not None:
        message.best_correct_count = best
    return message


def _model_choice_to_proto(choice: ModelChoice) -> ai_pb2.ModelChoice:
    return ai_pb2.ModelChoice(provider=choice.provider, model=choice.model, supports_tools=choice.supports_tools)


def _parse_user_id(value: str, context: grpc.ServicerContext) -> uuid.UUID:
    return _parse_uuid(value, "user_id", context)


def _provider_key_to_proto(key) -> ai_pb2.ProviderKey:
    created_at = timestamp_pb2.Timestamp()
    created_at.FromDatetime(key.created_at)
    return ai_pb2.ProviderKey(provider=key.provider, last4=key.last4, created_at=created_at)


def _llm_usage_to_proto(usage) -> ai_pb2.LlmUsage:
    created_at = timestamp_pb2.Timestamp()
    created_at.FromDatetime(usage.created_at)
    record = ai_pb2.LlmUsage(
        feature=usage.feature, provider=usage.provider, model=usage.model, key_source=usage.key_source,
        succeeded=usage.succeeded, created_at=created_at)
    # 未知的 token 數不設定欄位（proto3 optional），跟 0 分得開。
    if usage.input_tokens is not None:
        record.input_tokens = usage.input_tokens
    if usage.output_tokens is not None:
        record.output_tokens = usage.output_tokens
    return record
