import json
import itertools
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
from app.services.post_meeting import (
    InvalidTimezone,
    NotAvailable,
    NotRetryable,
    PostMeetingNotQueued,
    RunNotFound,
    RunStillGoing,
    RunView,
    UnknownProposal,
    execute_proposals,
    hints,
    post_meeting_state,
    request_post_meeting,
    retry_proposal,
    run_views,
)
from app.services.post_meeting import effective_status as post_meeting_effective_status
from app.services.post_meeting_settings import (
    InvalidLocation,
    NotionLocation,
    NotionNotLinked,
    Settings,
    get_settings,
    save_settings,
)
from app.services.notion import NotionUnreachable
from app.repositories.speaker_suggestion_repository import list_speaker_suggestions, set_speaker_suggestion_status
from app.repositories.web_search_usage_repository import count_user_web_searches, list_job_web_searches
from app.services.web_search import WebSearchResult
from app.services.web_search import is_available as web_search_available
from app.services.qa import AnswerStep, NoEmbeddingsError, stream_answer
from app.services.generated_outputs import (
    InvalidContent, InvalidOutputRequest, OutputNotEditable, OutputNotFound, OutputNotQueued, find_output, list_outputs,
    request_output, update_content)
from app.services.generated_outputs import effective_status as output_effective_status
from app.services.translations import (
    TranslationNotQueued, TranslationProgress, UnknownLanguage, delete_translation, find_translation, list_translations,
    request_translation)
from app.services.translations import effective_status as translation_effective_status
from app.services.decisions import DecisionsNotQueued, find_job_decisions, request_decision_extraction
from app.services.decisions import effective_status as decision_effective_status
from app.services.speaker_insight_runs import (
    SpeakerInsightsNotQueued, find_speaker_insights, request_speaker_insights)
from app.services.speaker_insight_runs import effective_status as speaker_insights_effective_status
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
from app.models import (
    ConnectionStatus,
    Decision,
    DecisionExtraction,
    DecisionExtractionStatus,
    TranslationStatus,
    GeneratedOutput,
    OutputStatus,
    SpeakerInsightItem,
    SpeakerInsightRun,
    SpeakerInsightsStatus,
    PostMeetingStatus,
    ProposalStatus,
    Quiz,
    QuizQuestion,
    QuizStatus,
    RegenerationStatus,
    SpeakerSuggestion,
    TodoDestination,
)
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
            chunks = stream_answer(session, job_id, question, user_id=user_id, requested_model=requested_model,
                                   web_search=request.web_search)

            # 「這個 job 還沒有內容」與「用不到的模型」一定發生在第一個 yield 之前（見 qa.stream_answer）：那時還沒送出任何
            # chunk，NoEmbeddingsError 維持 NOT_FOUND、ModelNotAvailable 維持 INVALID_ARGUMENT 的 abort，Gateway 才能回一般的
            # 404／400。之後的任何例外（改寫、檢索、搜尋、生成失敗）視為這輪問答本身失敗，改用 error chunk 讓 stream 正常結束，
            # 不寫 qa_history。
            try:
                first = next(chunks)
            except NoEmbeddingsError:
                _abort(context, grpc.StatusCode.NOT_FOUND,
                       "no transcript content available for this job yet")
            except ModelNotAvailable as exc:
                _abort(context, grpc.StatusCode.INVALID_ARGUMENT, str(exc))
            except Exception as exc:
                logger.exception("failed to prepare answer for job %s", job_id)
                yield ai_pb2.AskQuestionChunk(error=_stream_error_message(exc))
                return

            source_timestamps: list[float] = []
            answer_parts: list[str] = []
            answered_by: tuple[str, str] = ("", "")
            web: WebSearchResult | None = None
            try:
                for kind, payload in itertools.chain([first], chunks):
                    if isinstance(payload, AnswerStep):
                        yield ai_pb2.AskQuestionChunk(step=ai_pb2.AnswerStep(
                            id=payload.id, label=payload.label, state=payload.state, detail=payload.detail))
                    elif isinstance(payload, WebSearchResult):
                        web = payload
                        yield ai_pb2.AskQuestionChunk(web_sources=ai_pb2.WebSources(
                            sources=[ai_pb2.WebSource(title=s.title, url=s.url) for s in web.sources], failed=web.failed))
                    elif kind == "sources":
                        source_timestamps = payload  # type: ignore[assignment]
                        yield ai_pb2.AskQuestionChunk(
                            sources=ai_pb2.SourceTimestamps(source_timestamps=source_timestamps))
                    elif kind == "answered_by":
                        answered_by = payload  # type: ignore[assignment]
                        yield ai_pb2.AskQuestionChunk(
                            answered_by=ai_pb2.ModelChoice(provider=answered_by[0], model=answered_by[1]))
                    else:
                        answer_parts.append(payload)  # type: ignore[arg-type]
                        yield ai_pb2.AskQuestionChunk(delta=payload)  # type: ignore[arg-type]
            except Exception as exc:
                logger.exception("answer streaming failed mid-flight for job %s", job_id)
                yield ai_pb2.AskQuestionChunk(error=_stream_error_message(exc))
                return

            save_qa(session, job_id, user_id, question, "".join(answer_parts), source_timestamps, model=answered_by,
                    web_search=web is not None, web_sources=web.sources if web else [])
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
                    web_search=turn.web_search,
                    web_sources=[ai_pb2.WebSource(title=s["title"], url=s["url"]) for s in turn.web_sources],
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

    def ListJobWebSearches(self, request, context):
        try:
            job_id = uuid.UUID(request.job_id)
        except ValueError:
            _abort(context, grpc.StatusCode.INVALID_ARGUMENT, "job_id must be a valid UUID")

        session = new_session()
        try:
            records = []
            for usage in list_job_web_searches(session, job_id):
                created_at = timestamp_pb2.Timestamp()
                created_at.FromDatetime(usage.created_at)
                records.append(ai_pb2.WebSearchUsage(provider=usage.provider, succeeded=usage.succeeded,
                                                     created_at=created_at))
            return ai_pb2.ListJobWebSearchesResponse(records=records)
        finally:
            session.close()

    def ListSpeakerSuggestions(self, request, context):
        job_id = _parse_job_id(request.job_id, context)
        session = new_session()
        try:
            return ai_pb2.ListSpeakerSuggestionsResponse(
                suggestions=[_speaker_suggestion_to_proto(s) for s in list_speaker_suggestions(session, job_id)])
        finally:
            session.close()

    def SetSpeakerSuggestionStatus(self, request, context):
        job_id = _parse_job_id(request.job_id, context)
        if request.status not in ("applied", "dismissed"):
            _abort(context, grpc.StatusCode.INVALID_ARGUMENT, "status must be applied or dismissed")
        session = new_session()
        try:
            suggestion = set_speaker_suggestion_status(session, job_id, request.speaker_label, request.status)
            if suggestion is None:
                _abort(context, grpc.StatusCode.NOT_FOUND, "no suggestion for this speaker")
            return _speaker_suggestion_to_proto(suggestion)
        finally:
            session.close()

    def CountUserWebSearches(self, request, context):
        user_id = _parse_user_id(request.user_id, context)
        if not (request.HasField("start") and request.HasField("end")):
            _abort(context, grpc.StatusCode.INVALID_ARGUMENT, "start and end are required")

        session = new_session()
        try:
            succeeded, failed = count_user_web_searches(session, user_id, request.start.ToDatetime(timezone.utc),
                                                        request.end.ToDatetime(timezone.utc))
        finally:
            session.close()
        return ai_pb2.CountUserWebSearchesResponse(succeeded=succeeded, failed=failed)

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
            models=[_model_choice_to_proto(model) for model in models], openrouter_custom=openrouter_custom,
            web_search=web_search_available())

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

    def RequestOutput(self, request, context):
        job_id = _parse_uuid(request.job_id, "job_id", context)
        user_id = _parse_user_id(request.user_id, context)
        try:
            output = request_output(job_id, user_id, request.format, title=request.title, instruction=request.instruction,
                                    platform=request.platform)
        except InvalidOutputRequest:
            _abort(context, grpc.StatusCode.INVALID_ARGUMENT, "格式或平台不支援，或要求超過 200 字")
        except OutputNotQueued:
            _abort(context, grpc.StatusCode.UNAVAILABLE, "暫時無法產生，請稍後再試")
        return _output_to_proto(output)

    def ListOutputs(self, request, context):
        job_id = _parse_uuid(request.job_id, "job_id", context)
        return ai_pb2.ListOutputsResponse(outputs=[_output_to_proto(output) for output in list_outputs(job_id)])

    def GetOutput(self, request, context):
        job_id = _parse_uuid(request.job_id, "job_id", context)
        output_id = _parse_uuid(request.output_id, "output_id", context)
        output = find_output(job_id, output_id)
        if output is None:
            _abort(context, grpc.StatusCode.NOT_FOUND, "output not found")
        return _output_to_proto(output)

    def UpdateOutput(self, request, context):
        job_id = _parse_uuid(request.job_id, "job_id", context)
        output_id = _parse_uuid(request.output_id, "output_id", context)
        try:
            output = update_content(job_id, output_id, request.content)
        except InvalidContent:
            _abort(context, grpc.StatusCode.INVALID_ARGUMENT, "內容不能是空的，也不能超過 20000 字")
        except OutputNotFound:
            _abort(context, grpc.StatusCode.NOT_FOUND, "output not found")
        except OutputNotEditable:
            _abort(context, grpc.StatusCode.FAILED_PRECONDITION, "還沒產生完成，不能修改")
        return _output_to_proto(output)

    def RequestTranslation(self, request, context):
        job_id = _parse_uuid(request.job_id, "job_id", context)
        user_id = _parse_user_id(request.user_id, context)
        try:
            request_translation(job_id, user_id, request.language)
        except UnknownLanguage:
            _abort(context, grpc.StatusCode.INVALID_ARGUMENT, "不支援這種語言")
        except TranslationNotQueued:
            _abort(context, grpc.StatusCode.UNAVAILABLE, "暫時無法翻譯，請稍後再試")
        found = find_translation(job_id, request.language)
        if found is None:  # deleted right after it was asked for
            _abort(context, grpc.StatusCode.NOT_FOUND, "translation not found")
        return _translation_to_proto(found[0])

    def ListTranslations(self, request, context):
        job_id = _parse_uuid(request.job_id, "job_id", context)
        return ai_pb2.ListTranslationsResponse(
            translations=[_translation_to_proto(progress) for progress in list_translations(job_id)])

    def GetTranslation(self, request, context):
        job_id = _parse_uuid(request.job_id, "job_id", context)
        found = find_translation(job_id, request.language)
        if found is None:
            _abort(context, grpc.StatusCode.NOT_FOUND, "translation not found")
        progress, segments = found
        message = _translation_to_proto(progress)
        message.segments.extend(ai_pb2.SegmentTranslation(segment_id=str(s.segment_id), text=s.text,
                                                          source_text=s.source_text) for s in segments)
        return message

    def DeleteTranslation(self, request, context):
        job_id = _parse_uuid(request.job_id, "job_id", context)
        if not delete_translation(job_id, request.language):
            _abort(context, grpc.StatusCode.NOT_FOUND, "translation not found")
        return ai_pb2.DeleteTranslationResponse()

    def RequestDecisionExtraction(self, request, context):
        job_id = _parse_uuid(request.job_id, "job_id", context)
        user_id = _parse_user_id(request.user_id, context)
        try:
            request_decision_extraction(job_id, user_id)
        except DecisionsNotQueued:
            _abort(context, grpc.StatusCode.UNAVAILABLE, "暫時無法抽取決策，請稍後再試")
        extraction, _ = find_job_decisions(job_id)
        return _decision_extraction_to_proto(extraction)

    def GetJobDecisions(self, request, context):
        job_id = _parse_uuid(request.job_id, "job_id", context)
        extraction, decisions = find_job_decisions(job_id)
        message = ai_pb2.JobDecisions(decisions=[_decision_to_proto(d) for d in decisions])
        if extraction is not None:
            message.extraction.CopyFrom(_decision_extraction_to_proto(extraction))
        return message

    def RequestSpeakerInsights(self, request, context):
        job_id = _parse_uuid(request.job_id, "job_id", context)
        user_id = _parse_user_id(request.user_id, context)
        try:
            request_speaker_insights(job_id, user_id)
        except SpeakerInsightsNotQueued:
            _abort(context, grpc.StatusCode.UNAVAILABLE, "暫時無法分析，請稍後再試")
        return _speaker_insights_to_proto(job_id, *find_speaker_insights(job_id))

    def GetSpeakerInsights(self, request, context):
        job_id = _parse_uuid(request.job_id, "job_id", context)
        return _speaker_insights_to_proto(job_id, *find_speaker_insights(job_id))

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


    def GetPostMeeting(self, request, context):
        job_id = _parse_uuid(request.job_id, "job_id", context)
        user_id = _parse_user_id(request.user_id, context)
        reason, views = post_meeting_state(job_id, user_id)
        return _post_meeting_to_proto(views, available=reason is None, unavailable_reason=reason or "",
                                      hints=hints(user_id) if reason is None else [])

    def RequestPostMeeting(self, request, context):
        job_id = _parse_uuid(request.job_id, "job_id", context)
        user_id = _parse_user_id(request.user_id, context)
        if not request.HasField("uploaded_at"):
            _abort(context, grpc.StatusCode.INVALID_ARGUMENT, "uploaded_at is required")
        try:
            request_post_meeting(job_id, user_id, request.timezone, request.uploaded_at.ToDatetime(timezone.utc))
        except InvalidTimezone:
            _abort(context, grpc.StatusCode.INVALID_ARGUMENT, f"不認得的時區：{request.timezone}")
        except NotAvailable as exc:
            _abort(context, grpc.StatusCode.FAILED_PRECONDITION, str(exc))
        except PostMeetingNotQueued:
            _abort(context, grpc.StatusCode.UNAVAILABLE, "暫時無法開始會後處理，請稍後再試")
        return _post_meeting_to_proto(run_views(job_id), available=True)


    def ExecuteProposals(self, request, context):
        job_id = _parse_uuid(request.job_id, "job_id", context)
        user_id = _parse_user_id(request.user_id, context)
        run_id = _parse_uuid(request.run_id, "run_id", context)
        confirmed = [(_parse_uuid(p.proposal_id, "proposal_id", context), p.arguments_json) for p in request.proposals]
        return self._run_after_proposals(context, lambda: execute_proposals(job_id, user_id, run_id, confirmed))

    def RetryProposal(self, request, context):
        job_id = _parse_uuid(request.job_id, "job_id", context)
        user_id = _parse_user_id(request.user_id, context)
        run_id = _parse_uuid(request.run_id, "run_id", context)
        proposal_id = _parse_uuid(request.proposal_id, "proposal_id", context)
        return self._run_after_proposals(context, lambda: retry_proposal(job_id, user_id, run_id, proposal_id))

    def _run_after_proposals(self, context, work):
        try:
            view = work()
        except RunNotFound:
            _abort(context, grpc.StatusCode.NOT_FOUND, "post-meeting run not found")
        except RunStillGoing:
            _abort(context, grpc.StatusCode.FAILED_PRECONDITION, "會後處理還在進行中，等它完成再執行提案")
        except UnknownProposal:
            _abort(context, grpc.StatusCode.INVALID_ARGUMENT, "有提案不屬於這次會後處理")
        except NotRetryable:
            _abort(context, grpc.StatusCode.FAILED_PRECONDITION, "只有失敗的提案可以重試")
        return _post_meeting_run_to_proto(view)


    def GetPostMeetingSettings(self, request, context):
        return _settings_to_proto(get_settings(_parse_user_id(request.user_id, context)))

    def UpdatePostMeetingSettings(self, request, context):
        user_id = _parse_user_id(request.user_id, context)
        try:
            settings = save_settings(user_id, request.notion_meetings_page_url,
                                     _TODO_DESTINATION_FROM_PROTO.get(request.todo_destination))
        except NotionNotLinked:
            _abort(context, grpc.StatusCode.FAILED_PRECONDITION, "請先到設定頁連結 Notion 帳號")
        except InvalidLocation as exc:
            _abort(context, grpc.StatusCode.INVALID_ARGUMENT, str(exc))
        except NotionUnreachable as exc:
            _abort(context, grpc.StatusCode.UNAVAILABLE, str(exc))
        return _settings_to_proto(settings)


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


_PROPOSAL_STATUS = {
    ProposalStatus.PROPOSED: ai_pb2.PROPOSAL_STATUS_PROPOSED,
    ProposalStatus.DONE: ai_pb2.PROPOSAL_STATUS_DONE,
    ProposalStatus.FAILED: ai_pb2.PROPOSAL_STATUS_FAILED,
}

_POST_MEETING_STATUS = {
    PostMeetingStatus.RUNNING: ai_pb2.POST_MEETING_STATUS_RUNNING,
    PostMeetingStatus.COMPLETED: ai_pb2.POST_MEETING_STATUS_COMPLETED,
    PostMeetingStatus.LIMIT_REACHED: ai_pb2.POST_MEETING_STATUS_LIMIT_REACHED,
    PostMeetingStatus.FAILED: ai_pb2.POST_MEETING_STATUS_FAILED,
}


def _post_meeting_to_proto(views: Sequence[RunView], *, available: bool, unavailable_reason: str = "",
                           hints: Sequence[str] = ()) -> ai_pb2.PostMeeting:
    """views 是這個 Job 所有的紀錄，新的在前：第一份是 latest_run，其他是 earlier_runs。"""
    return ai_pb2.PostMeeting(available=available, unavailable_reason=unavailable_reason, hints=hints,
                              latest_run=_post_meeting_run_to_proto(views[0]) if views else None,
                              earlier_runs=[_post_meeting_run_to_proto(view) for view in views[1:]])


def _post_meeting_run_to_proto(view: RunView) -> ai_pb2.PostMeetingRun:
    run, proposals = view.run, view.proposals
    status, failure_reason = post_meeting_effective_status(run)
    message = ai_pb2.PostMeetingRun(
        id=str(run.id), status=_POST_MEETING_STATUS[status], progress=run.progress if status == PostMeetingStatus.RUNNING else "",
        failure_reason=failure_reason or "", model_provider=run.model_provider or "", model=run.model or "",
        proposals=[ai_pb2.ActionProposal(id=str(p.id), service=p.service, tool=p.tool, kind=p.kind,
                                         arguments_json=json.dumps(p.arguments, ensure_ascii=False),
                                         status=_PROPOSAL_STATUS[ProposalStatus(p.status)], result_url=p.result_url or "",
                                         failure_reason=p.failure_reason or "",
                                         previously_created=p.id in view.previously_created) for p in proposals])
    message.requested_at.FromDatetime(run.requested_at)
    if run.finished_at is not None:
        message.finished_at.FromDatetime(run.finished_at)
    return message


_TODO_DESTINATION_FROM_PROTO = {
    ai_pb2.TODO_DESTINATION_GOOGLE_TASKS: TodoDestination.GOOGLE_TASKS,
    ai_pb2.TODO_DESTINATION_NOTION: TodoDestination.NOTION,
}
_TODO_DESTINATION_TO_PROTO = {destination: value for value, destination in _TODO_DESTINATION_FROM_PROTO.items()}


def _settings_to_proto(settings: Settings) -> ai_pb2.PostMeetingSettings:
    def location(place: NotionLocation | None) -> ai_pb2.NotionLocation | None:
        return ai_pb2.NotionLocation(id=place.id, title=place.title, url=place.url) if place else None

    return ai_pb2.PostMeetingSettings(notion_meetings_page=location(settings.meetings_page),
                                      todo_destination=_TODO_DESTINATION_TO_PROTO[settings.todo_destination])


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


_TRANSLATION_STATUS = {
    TranslationStatus.GENERATING: ai_pb2.TRANSLATION_STATUS_GENERATING,
    TranslationStatus.COMPLETED: ai_pb2.TRANSLATION_STATUS_COMPLETED,
    TranslationStatus.FAILED: ai_pb2.TRANSLATION_STATUS_FAILED,
}


_DECISION_EXTRACTION_STATUS = {
    DecisionExtractionStatus.GENERATING: ai_pb2.DECISION_EXTRACTION_STATUS_GENERATING,
    DecisionExtractionStatus.COMPLETED: ai_pb2.DECISION_EXTRACTION_STATUS_COMPLETED,
    DecisionExtractionStatus.FAILED: ai_pb2.DECISION_EXTRACTION_STATUS_FAILED,
}


def _decision_extraction_to_proto(extraction: DecisionExtraction) -> ai_pb2.DecisionExtraction:
    status, failure_reason = decision_effective_status(extraction)
    message = ai_pb2.DecisionExtraction(
        job_id=str(extraction.job_id), status=_DECISION_EXTRACTION_STATUS[status], failure_reason=failure_reason or "",
        source_revision=extraction.source_revision or 0, model_provider=extraction.model_provider or "",
        model=extraction.model or "")
    message.requested_at.FromDatetime(extraction.requested_at)
    if extraction.completed_at is not None:
        message.completed_at.FromDatetime(extraction.completed_at)
    return message


def _decision_to_proto(decision: Decision) -> ai_pb2.Decision:
    message = ai_pb2.Decision(
        id=str(decision.id), job_id=str(decision.job_id), statement=decision.statement, rationale=decision.rationale,
        alternatives=decision.alternatives, proposed_by=decision.proposed_by or "", tentative=decision.tentative,
        evidence_text=decision.evidence_text or "", source=decision.source, edited=decision.edited,
        supersedes_id=str(decision.supersedes_id) if decision.supersedes_id else "")
    if decision.start_time is not None:
        message.start_time = float(decision.start_time)
    message.created_at.FromDatetime(decision.created_at)
    return message


def _translation_to_proto(progress: TranslationProgress) -> ai_pb2.Translation:
    translation = progress.translation
    status, failure_reason = translation_effective_status(translation)
    message = ai_pb2.Translation(
        job_id=str(translation.job_id), language=translation.language, status=_TRANSLATION_STATUS[status],
        failure_reason=failure_reason or "", total_segments=translation.total_segments,
        translated_segments=progress.translated_segments, model_provider=translation.model_provider or "",
        model=translation.model or "")
    message.requested_at.FromDatetime(translation.requested_at)
    if translation.completed_at is not None:
        message.completed_at.FromDatetime(translation.completed_at)
    return message


_OUTPUT_STATUS = {
    OutputStatus.GENERATING: ai_pb2.OUTPUT_STATUS_GENERATING,
    OutputStatus.COMPLETED: ai_pb2.OUTPUT_STATUS_COMPLETED,
    OutputStatus.FAILED: ai_pb2.OUTPUT_STATUS_FAILED,
}


def _output_to_proto(output: GeneratedOutput) -> ai_pb2.GeneratedOutput:
    status, failure_reason = output_effective_status(output)
    message = ai_pb2.GeneratedOutput(
        id=str(output.id), job_id=str(output.job_id), format=output.format,
        instruction=output.options.get("instruction", ""), platform=output.options.get("platform", ""),
        status=_OUTPUT_STATUS[status],
        failure_reason=failure_reason or "", content=output.content or "", source_revision=output.source_revision or 0,
        model_provider=output.model_provider or "", model=output.model or "")
    message.requested_at.FromDatetime(output.requested_at)
    if output.completed_at is not None:
        message.completed_at.FromDatetime(output.completed_at)
    if output.edited_at is not None:
        message.edited_at.FromDatetime(output.edited_at)
    return message


_SPEAKER_INSIGHTS_STATUS = {
    SpeakerInsightsStatus.GENERATING: ai_pb2.SPEAKER_INSIGHTS_STATUS_GENERATING,
    SpeakerInsightsStatus.COMPLETED: ai_pb2.SPEAKER_INSIGHTS_STATUS_COMPLETED,
    SpeakerInsightsStatus.FAILED: ai_pb2.SPEAKER_INSIGHTS_STATUS_FAILED,
}


def _speaker_insights_to_proto(job_id: uuid.UUID, run: SpeakerInsightRun | None,
                               items: Sequence[SpeakerInsightItem]) -> ai_pb2.SpeakerInsights:
    if run is None:
        return ai_pb2.SpeakerInsights(job_id=str(job_id))
    status, failure_reason = speaker_insights_effective_status(run)
    message = ai_pb2.SpeakerInsights(
        job_id=str(job_id), status=_SPEAKER_INSIGHTS_STATUS[status], failure_reason=failure_reason or "",
        source_revision=run.source_revision or 0, model_provider=run.model_provider or "", model=run.model or "",
        items=[ai_pb2.SpeakerInsight(kind=i.kind, speaker_label=i.speaker_label, interrupted_label=i.interrupted_label or "",
                                     start_time=float(i.start_time), text=i.text) for i in items])
    message.requested_at.FromDatetime(run.requested_at)
    if run.completed_at is not None:
        message.completed_at.FromDatetime(run.completed_at)
    return message


def _model_choice_to_proto(choice: ModelChoice) -> ai_pb2.ModelChoice:
    return ai_pb2.ModelChoice(provider=choice.provider, model=choice.model, supports_tools=choice.supports_tools)


def _parse_user_id(value: str, context: grpc.ServicerContext) -> uuid.UUID:
    return _parse_uuid(value, "user_id", context)


def _parse_job_id(value: str, context: grpc.ServicerContext) -> uuid.UUID:
    return _parse_uuid(value, "job_id", context)


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


def _speaker_suggestion_to_proto(suggestion: SpeakerSuggestion) -> ai_pb2.SpeakerSuggestion:
    return ai_pb2.SpeakerSuggestion(
        speaker_label=suggestion.speaker_label, name=suggestion.name,
        evidence_start_time=float(suggestion.evidence_start_time), evidence_text=suggestion.evidence_text,
        status=suggestion.status)

