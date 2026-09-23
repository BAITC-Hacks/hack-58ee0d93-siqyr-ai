import asyncio
import logging

from sqlalchemy.dialects.sqlite import insert
from sqlmodel import select

from .config import Settings, today
from .db import Database
from .mailer import send_due
from .models import Assignment, Notification, Run, identifier, utcnow

logger = logging.getLogger(__name__)


def assignment_view(item: Assignment, run_title: str, settings: Settings) -> dict:
    days = (item.deadline - today(settings)).days if item.deadline else None
    return {
        **item.model_dump(exclude={"done", "source_segments"}), "run_title": run_title,
        "status": "done" if item.done else "overdue" if days is not None and days < 0 else "in_progress",
        "days_left": days,
    }


def check_reminders(db: Database, settings: Settings) -> dict:
    current = today(settings)
    created = 0
    with db.session() as session:
        assignments = session.exec(select(Assignment).join(Run).where(Assignment.done == False, Run.status == "done")).all()  # noqa: E712
        for item in assignments:
            if item.deadline is None:
                continue
            days = (item.deadline - current).days
            if days > settings.remind_days_before:
                continue
            kind = "overdue" if days < 0 else "due_soon"
            message = f"{'Просрочено поручение' if days < 0 else 'Приближается срок поручения'}: {item.task}. Срок: {item.deadline}."
            result = session.execute(insert(Notification).values(
                id=identifier(), kind=kind, recipient=item.assignee, message=message,
                assignment_id=item.id, run_id=item.run_id, day=current, created_at=utcnow(),
            ).on_conflict_do_nothing(index_elements=["assignment_id", "kind", "day"]))
            created += result.rowcount
        session.commit()
    return {"created": created, "today": current.isoformat()}


async def reminder_loop(db: Database, settings: Settings):
    while True:
        try:
            await asyncio.to_thread(check_reminders, db, settings)
            await asyncio.to_thread(send_due, db, settings)
        except Exception:
            logger.exception("Не удалось проверить сроки поручений")
        await asyncio.sleep(settings.reminder_interval_sec)
