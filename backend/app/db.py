from sqlalchemy import event, inspect, text
from sqlmodel import SQLModel, Session, create_engine

from .config import Settings
from . import models  # noqa: F401: register tables


class Database:
    def __init__(self, settings: Settings):
        for directory in (settings.data_dir, settings.uploads_dir, settings.exports_dir):
            directory.mkdir(parents=True, exist_ok=True)
        self.engine = create_engine(
            "sqlite:///" + settings.db_path.as_posix(),
            connect_args={"check_same_thread": False, "timeout": 30},
        )

        @event.listens_for(self.engine, "connect")
        def configure_sqlite(connection, _):
            connection.execute("PRAGMA foreign_keys=ON")
            connection.execute("PRAGMA journal_mode=WAL")

        SQLModel.metadata.create_all(self.engine)
        # Existing MVP databases predate department ownership.
        with self.engine.begin() as connection:
            if "department_id" not in {c["name"] for c in inspect(connection).get_columns("runs")}:
                connection.execute(text("ALTER TABLE runs ADD COLUMN department_id VARCHAR NOT NULL DEFAULT 'default'"))
            connection.execute(text("CREATE INDEX IF NOT EXISTS ix_runs_department_id ON runs (department_id)"))
            if "run_id" not in {c["name"] for c in inspect(connection).get_columns("notifications")}:
                connection.execute(text("ALTER TABLE notifications ADD COLUMN run_id VARCHAR"))
            connection.execute(text("CREATE INDEX IF NOT EXISTS ix_notifications_run_id ON notifications (run_id)"))
            connection.execute(text("UPDATE notifications SET run_id = (SELECT assignments.run_id FROM assignments WHERE assignments.id = notifications.assignment_id) WHERE run_id IS NULL AND assignment_id IS NOT NULL"))
            connection.execute(text("INSERT OR IGNORE INTO organizations (id, name) VALUES ('default', 'Основная организация')"))
            connection.execute(text("INSERT OR IGNORE INTO departments (id, organization_id, name) VALUES ('default', 'default', 'Общий департамент')"))

    def session(self) -> Session:
        return Session(self.engine, expire_on_commit=False)

    def close(self):
        self.engine.dispose()
