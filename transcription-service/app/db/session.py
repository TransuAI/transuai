import logging
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import settings

logger = logging.getLogger(__name__)

engine = create_engine(settings.database_url, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)

_MIGRATIONS = Path(__file__).parent / "migrations"
# The revision (app/db/migrations/versions/0001_baseline.py) that describes the schema SQLAlchemy
# create_all used to build before migrations existed, and the tables it contains.
_BASELINE_REVISION = "0001"
_BASELINE_TABLES = {"transcripts", "transcript_segments"}
# Arbitrary app-wide key for pg_advisory_xact_lock, so replicas starting together migrate one at a time.
_MIGRATION_LOCK_KEY = 7_202_609_26


def init_db() -> None:
    """Brings the database schema up to date with the versioned migrations (Alembic)."""
    config = Config()
    config.set_main_option("script_location", str(_MIGRATIONS))
    with engine.begin() as connection:
        connection.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": _MIGRATION_LOCK_KEY})
        config.attributes["connection"] = connection
        tables = set(inspect(connection).get_table_names())
        if "alembic_version" not in tables and tables & _BASELINE_TABLES:
            # Databases created before migrations existed already have the baseline tables but no
            # alembic_version: adopt them as the baseline instead of creating the tables again. A
            # partial set can't be the baseline, and stamping it would only fail later on first use.
            missing = _BASELINE_TABLES - tables
            if missing:
                raise RuntimeError(
                    f"database has part of the pre-migration schema but not {sorted(missing)}; "
                    "fix it by hand (or drop the tables) before starting the service")
            logger.info("adopting a pre-migration database as revision %s", _BASELINE_REVISION)
            command.stamp(config, _BASELINE_REVISION)
        command.upgrade(config, "head")


def new_session() -> Session:
    return SessionLocal()
