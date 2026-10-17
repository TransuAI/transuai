"""使用者刪除了帳號（`account.deleted`）：轉錄用量去識別化（user_id 設 NULL），別人的不動（見 .scratch/account-deletion/issues/02）。"""

import uuid

from sqlalchemy import func, select

from app.models.transcript import TranscriptionUsage
from app.repositories.transcription_usage_repository import TranscriptionUsageRecord, save_transcription_usage
from app.services import account_deletion, deletion_consumer


def usage(user_id):
    save_transcription_usage(TranscriptionUsageRecord(
        user_id=user_id, job_id=uuid.uuid4(), provider="deepgram", model="nova-3", audio_seconds=60.0, succeeded=True))


def test_transcription_usage_is_kept_but_no_longer_linked_to_the_user(db_session):
    leaving, staying = uuid.uuid4(), uuid.uuid4()
    usage(leaving)
    usage(staying)

    account_deletion.delete_account_data(leaving)
    account_deletion.delete_account_data(leaving)  # 重複也沒事

    count = lambda *where: db_session.scalar(select(func.count()).select_from(TranscriptionUsage).where(*where))
    assert count(TranscriptionUsage.user_id == leaving) == 0
    assert count(TranscriptionUsage.user_id == staying) == 1
    assert count(TranscriptionUsage.user_id.is_(None)) == 1


def test_account_deleted_has_its_own_queue():
    queues = {s.exchange: s.queue for s in deletion_consumer.subscriptions()}

    assert queues["account.deleted"] == "account.deleted.transcription"
