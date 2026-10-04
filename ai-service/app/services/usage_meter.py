import logging
import uuid
from dataclasses import dataclass
from enum import StrEnum

from app.repositories.llm_usage_repository import LlmUsageRecord, save_llm_usage
from app.services.llm_client import PLATFORM, ChatModel, TokenUsage

logger = logging.getLogger(__name__)


class KeySource(StrEnum):
    """這次呼叫用的是誰的金鑰：平台模型，或使用者的自有金鑰。"""

    PLATFORM = "platform"
    OWN_KEY = "own_key"


def job_owner(payload: dict) -> uuid.UUID | None:
    """佇列訊息裡的 Job 擁有者（`userId`）；升級當下還在佇列裡的舊訊息沒有這個欄位。格式不對時也當成不知道，
    用量少記一個使用者，不值得讓整則訊息失敗。"""
    try:
        return uuid.UUID(payload["userId"]) if payload.get("userId") else None
    except ValueError:
        logger.warning("ignoring malformed userId %r in message for job %s", payload.get("userId"), payload.get("jobId"))
        return None


class LlmFeature(StrEnum):
    """用量記錄裡的「功能」：這次 LLM 呼叫是為了什麼。"""

    SUMMARY = "summary"
    CHAPTERS = "chapters"
    QA_ANSWER = "qa_answer"
    QA_REWRITE = "qa_rewrite"  # 問答前的問題改寫
    REGENERATED_SUMMARY = "regenerated_summary"
    REGENERATED_CHAPTERS = "regenerated_chapters"
    QUIZ = "quiz"
    POST_MEETING = "post_meeting"
    JOB_TITLE = "job_title"  # 替 Job 取標題、判斷類型
    SPEAKER_NAMES = "speaker_names"  # 講者名字建議
    SPEAKER_INSIGHTS = "speaker_insights"  # 講者數據：問題與打斷
    GENERATED_OUTPUT = "generated_output"  # 多格式輸出
    TRANSLATION = "translation"  # 譯文
    DECISION_EXTRACTION = "decision_extraction"  # 決策紀錄：抽出一場的決策
    DECISION_QA = "decision_qa"  # 問決策


@dataclass(frozen=True)
class UsageMeter:
    """把一次 LLM 呼叫的用量記在這位使用者、這個 Job、這個功能名下（見 llm_client 的 meter 參數）。"""

    user_id: uuid.UUID | None  # 升級當下沒帶 userId 的舊訊息是 None
    job_id: uuid.UUID | None  # 問決策跨 Job，不屬於任何一個
    feature: LlmFeature

    def record(self, model: ChatModel, usage: TokenUsage, succeeded: bool) -> None:
        try:
            save_llm_usage(LlmUsageRecord(
                user_id=self.user_id, job_id=self.job_id, feature=self.feature, provider=model.provider,
                model=model.model, key_source=KeySource.PLATFORM if model.provider == PLATFORM else KeySource.OWN_KEY,
                input_tokens=usage.input_tokens, output_tokens=usage.output_tokens, succeeded=succeeded,
            ))
        except Exception:
            # 記不到用量不能讓摘要或問答跟著失敗；少一筆紀錄比整個 Job 失敗好。
            logger.exception("could not record LLM usage for job %s (%s)", self.job_id, self.feature)
