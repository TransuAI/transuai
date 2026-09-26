import uuid

from app.proto_gen import ai_pb2
from app.repositories.summary_repository import save_summary


def test_get_summary_says_which_transcript_revision_it_was_built_from(ai_stub, db_session):
    job_id = uuid.uuid4()
    save_summary(db_session, job_id, "討論了預算。", source_revision=4)

    summary = ai_stub.GetSummary(ai_pb2.GetSummaryRequest(job_id=str(job_id)))

    assert (summary.summary_text, summary.source_revision) == ("討論了預算。", 4)
