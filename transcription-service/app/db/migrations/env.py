from alembic import context
from sqlalchemy import engine_from_config, pool

from app.core.config import settings
from app.models import Base

config = context.config
config.set_main_option("sqlalchemy.url", settings.database_url)
target_metadata = Base.metadata


def run_migrations(connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata)
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    # init_db() hands over its own connection; the alembic CLI builds one from the settings.
    connection = config.attributes.get("connection")
    if connection is not None:
        run_migrations(connection)
        return

    engine = engine_from_config(
        config.get_section(config.config_ini_section, {}), prefix="sqlalchemy.", poolclass=pool.NullPool)
    with engine.connect() as conn:
        run_migrations(conn)


if context.is_offline_mode():
    raise RuntimeError("offline (SQL script) migrations are not used in this project")
run_migrations_online()
