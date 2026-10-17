from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import settings

engine = create_engine(settings.database_url, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)

_MIGRATIONS = Path(__file__).parent / "migrations"
# Key for pg_advisory_xact_lock, so replicas starting together migrate one at a time. Any constant
# works as long as nothing else in ai_db takes the same advisory lock.
_MIGRATION_LOCK_KEY = 820260926


def init_db() -> None:
    """Brings the database schema up to date with the versioned migrations (Alembic).

    A database from before migrations existed has no alembic_version, so it simply runs from the
    baseline, which only adds the tables it's missing (see versions/0001_baseline.py). Unlike
    transcription-service, which stamps a pre-migration database as its baseline, there's no stamp
    step here: ai_db's tables were added one feature at a time, so old databases hold any subset of
    them (the dev ai_db only has summaries).
    """
    config = Config()
    config.set_main_option("script_location", str(_MIGRATIONS))
    with engine.begin() as connection:
        connection.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": _MIGRATION_LOCK_KEY})
        config.attributes["connection"] = connection
        command.upgrade(config, "head")


def new_session() -> Session:
    return SessionLocal()
