import uuid
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Quiz, QuizQuestion, QuizStatus


def list_quizzes(session: Session, job_id: uuid.UUID) -> list[Quiz]:
    return list(session.scalars(
        select(Quiz).where(Quiz.job_id == job_id).order_by(Quiz.requested_at.desc(), Quiz.id)))


def find_quiz(session: Session, job_id: uuid.UUID, quiz_id: uuid.UUID) -> Quiz | None:
    return session.scalar(select(Quiz).where(Quiz.id == quiz_id, Quiz.job_id == job_id))


def list_questions(session: Session, quiz_id: uuid.UUID) -> list[QuizQuestion]:
    return list(session.scalars(
        select(QuizQuestion).where(QuizQuestion.quiz_id == quiz_id).order_by(QuizQuestion.position)))


def complete_quiz(
    session: Session, quiz_id: uuid.UUID, questions: list[QuizQuestion], *, source_revision: int,
    model: tuple[str, str], completed_at: datetime,
) -> None:
    """題目與「完成」一起寫入：不會留下只有一半題目的測驗。只完成還在產生中的（鎖住那一列，同一份測驗不會被
    寫兩次題目）。"""
    quiz = session.get(Quiz, quiz_id, with_for_update=True)
    if quiz is None or quiz.status != QuizStatus.GENERATING:
        session.rollback()
        return
    session.add_all(questions)
    quiz.status = QuizStatus.COMPLETED
    quiz.failure_reason = None
    quiz.source_revision = source_revision
    quiz.model_provider, quiz.model = model
    quiz.completed_at = completed_at
    session.commit()


def fail_quiz(session: Session, quiz_id: uuid.UUID, reason: str) -> None:
    quiz = session.get(Quiz, quiz_id, with_for_update=True)
    if quiz is not None and quiz.status == QuizStatus.GENERATING:
        quiz.status = QuizStatus.FAILED
        quiz.failure_reason = reason
    session.commit()
