"""Почтовые напоминания о сроках поручений (сценарий 2 ТЗ) через SMTP из .env.

check_reminders раз в день создаёт на поручение запись due_soon/overdue; здесь сегодняшние записи уходят письмом
ответственному (NOTIFY_EMAILS: имя из протокола -> адрес) и копией руководителю/куратору (NOTIFY_CC).
Одно письмо на адресата со всеми его напоминаниями. Отправленное фиксируется в email_deliveries и не повторяется,
ошибка SMTP повторяется на следующих проверках до MAX_ATTEMPTS. Адрес не угадывается по имени.

Проверка настроек: python -m backend.app.mailer you@example.com
"""
from __future__ import annotations

import html
import json
import logging
import smtplib
import ssl
import sys
import threading
from collections import defaultdict
from datetime import date
from email.message import EmailMessage
from email.utils import formataddr, make_msgid

from sqlmodel import col, select

from .config import Settings, today
from .db import Database
from .models import Assignment, EmailDelivery, Notification, Run, utcnow

logger = logging.getLogger(__name__)
KINDS = ("due_soon", "overdue")
MAX_ATTEMPTS = 3
TIMEOUT_SEC = 20
# Фоновая проверка и ручной POST /api/reminders/run не должны отправить одно напоминание дважды.
_lock = threading.Lock()


class MailError(RuntimeError):
    pass


def security(settings: Settings) -> str:
    mode = settings.smtp_security or ("ssl" if settings.smtp_port == 465 else "starttls")
    if mode not in {"ssl", "starttls", "none"}:
        raise MailError("SMTP_SECURITY должен быть starttls, ssl или none.")
    return mode


def sender(settings: Settings) -> str:
    address = settings.smtp_from or settings.smtp_user
    if "@" not in address:
        raise MailError("Задайте SMTP_FROM (адрес отправителя) или SMTP_USER в виде email.")
    return address


def address_book(settings: Settings) -> dict[str, str]:
    try:
        book = json.loads(settings.notify_emails or "{}")
    except ValueError:
        book = None
    if not isinstance(book, dict) or not all(isinstance(v, str) and "@" in v for v in book.values()):
        raise MailError('NOTIFY_EMAILS должен быть JSON-объектом {"имя из протокола": "email"}.')
    return {name.strip().casefold(): email.strip() for name, email in book.items()}


def curators(settings: Settings) -> list[str]:
    return [address.strip() for address in settings.notify_cc.split(",") if address.strip()]


def personal_address(name: str, book: dict[str, str]) -> str | None:
    """Только явное сопоставление или имя, которое уже является адресом."""
    return book.get(name.strip().casefold()) or (name.strip() if "@" in name else None)


def connect(settings: Settings) -> smtplib.SMTP:
    mode = security(settings)
    context = ssl.create_default_context()
    if mode == "ssl":
        client = smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port, timeout=TIMEOUT_SEC, context=context)
    else:
        client = smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=TIMEOUT_SEC)
    try:
        if mode == "starttls":
            client.starttls(context=context)
        if settings.smtp_user:
            client.login(settings.smtp_user, settings.smtp_password)
    except BaseException:
        client.close()
        raise
    return client


def describe(exc: OSError) -> str:
    if isinstance(exc, smtplib.SMTPAuthenticationError):
        return "SMTP отклонил SMTP_USER/SMTP_PASSWORD (для Gmail и Яндекса нужен пароль приложения, для Resend — действующий RESEND_API_KEY)."
    if isinstance(exc, smtplib.SMTPRecipientsRefused):
        # Причина от сервера важна: Resend без своего домена принимает только адрес владельца аккаунта.
        return ("SMTP отклонил адрес получателя: " + "; ".join(
            f"{address} ({code} {reply.decode(errors='replace')})" for address, (code, reply) in exc.recipients.items()))[:300]
    if isinstance(exc, smtplib.SMTPSenderRefused):
        return "SMTP отклонил отправителя: проверьте SMTP_FROM."
    if isinstance(exc, smtplib.SMTPNotSupportedError):
        return f"SMTP-сервер не поддерживает команду ({exc}): проверьте SMTP_SECURITY."
    if isinstance(exc, smtplib.SMTPResponseException):
        return f"SMTP ответил {exc.smtp_code}: {exc.smtp_error.decode(errors='replace')}"[:300]
    # smtplib.SMTPException — подкласс OSError: сюда попадают обрыв соединения, таймаут и неверный режим TLS.
    return f"SMTP-сервер недоступен ({exc.__class__.__name__}): проверьте SMTP_HOST, SMTP_PORT и SMTP_SECURITY."


def days_word(days: int) -> str:
    if days % 10 == 1 and days % 100 != 11:
        return f"{days} день"
    if 2 <= days % 10 <= 4 and not 12 <= days % 100 <= 14:
        return f"{days} дня"
    return f"{days} дней"


def due_phrase(deadline: date, current: date) -> str:
    days = (deadline - current).days
    if days < 0:
        return f"просрочено на {days_word(-days)}"
    return "срок сегодня" if days == 0 else "срок завтра" if days == 1 else f"срок через {days_word(days)}"


def item_lines(assignment: Assignment, run: Run, current: date, settings: Settings) -> list[tuple[str, str]]:
    said = f" (сказано: «{assignment.deadline_text}»)" if assignment.deadline_text else ""
    meeting = run.meeting_date.strftime("%d.%m.%Y") if run.meeting_date else "дата не указана"
    lines = [("Ответственный", assignment.assignee),
             ("Срок", f"{assignment.deadline:%d.%m.%Y} — {due_phrase(assignment.deadline, current)}{said}"),
             ("Совещание", f"«{run.title}», {meeting}" + (" · синтетические демонстрационные данные" if run.synthetic else ""))]
    if settings.public_app_url:
        lines.append(("Карточка", f"{settings.public_app_url}/meetings/{run.id}"))
    return lines


def compose(settings: Settings, to: list[str], cc: list[str], items: list[tuple[Notification, Assignment, Run]], current: date) -> EmailMessage:
    overdue = sum(note.kind == "overdue" for note, _, _ in items)
    if len(items) == 1:
        _, assignment, _ = items[0]
        task = assignment.task if len(assignment.task) <= 70 else assignment.task[:69] + "…"
        subject = f"просрочено поручение: {task}" if overdue else f"{due_phrase(assignment.deadline, current)}: {task}"
    else:
        subject = f"напоминание по {len(items)} поручениям" + (f", просрочено {overdue}" if overdue else "")
    address = sender(settings)
    message = EmailMessage()
    message["Subject"] = f"Siqyr AI · {subject}"
    message["From"] = formataddr(("Siqyr AI", address))
    message["To"] = ", ".join(to)
    if cc:
        message["Cc"] = ", ".join(cc)
    message["Message-ID"] = make_msgid(domain=address.rsplit("@", 1)[1])
    intro = "Напоминание о сроках поручений из утверждённых протоколов совещаний."
    footer = "Письмо отправлено автоматически системой Siqyr AI. Выполнение отмечается в реестре поручений."
    text = [intro, ""]
    rows = []
    for note, assignment, run in items:
        lines = item_lines(assignment, run, current, settings)
        text += [f"• {assignment.task}", *(f"  {label}: {value}" for label, value in lines), ""]
        color = "#c92a2a" if note.kind == "overdue" else "#e67700"
        details = "".join(f'<div style="color:#495057">{html.escape(label)}: '
                          + (f'<a href="{html.escape(value)}">{html.escape(value)}</a>' if label == "Карточка" else html.escape(value))
                          + "</div>" for label, value in lines)
        rows.append(f'<div style="border-left:4px solid {color};padding:8px 12px;margin:12px 0">'
                    f'<div style="font-weight:600">{html.escape(assignment.task)}</div>{details}</div>')
    message.set_content("\n".join([*text, footer]))
    message.add_alternative(
        f'<div style="font-family:Arial,sans-serif;font-size:14px;color:#212529"><p>{html.escape(intro)}</p>{"".join(rows)}'
        f'<p style="color:#868e96;font-size:12px">{html.escape(footer)}</p></div>', subtype="html")
    return message


def record(db: Database, notes: list[Notification], status: str, recipients: list[str], error: str | None):
    with db.session() as session:
        for note in notes:
            item = session.get(EmailDelivery, note.id) or EmailDelivery(notification_id=note.id, status=status)
            item.status, item.recipients, item.error = status, ", ".join(recipients), error
            item.attempts += 1
            item.updated_at = utcnow()
            session.add(item)
        session.commit()


def send_due(db: Database, settings: Settings) -> dict:
    """Отправляет сегодняшние напоминания, ещё не доставленные письмом. Счётчики — для API и логов."""
    stats: dict = {"enabled": bool(settings.smtp_host), "sent": 0, "failed": 0, "unmapped": []}
    if not settings.smtp_host:
        return stats
    with _lock:
        try:
            book, copies = address_book(settings), curators(settings)
            security(settings)
            sender(settings)
        except MailError as exc:
            logger.error("Напоминания не отправлены: %s", exc)
            return {**stats, "error": str(exc)}
        current = today(settings)
        finished = select(EmailDelivery.notification_id).where(
            (EmailDelivery.status == "sent") | (EmailDelivery.attempts >= MAX_ATTEMPTS))
        with db.session() as session:
            rows = session.exec(
                select(Notification, Assignment, Run)
                .join(Assignment, Notification.assignment_id == Assignment.id)
                .join(Run, Assignment.run_id == Run.id)
                .where(col(Notification.kind).in_(KINDS), Notification.day == current, Assignment.done == False,  # noqa: E712
                       col(Assignment.deadline).is_not(None), col(Notification.id).not_in(finished))
                .order_by(Assignment.deadline)
            ).all()
        # Ключ — личный адрес ответственного; "" — адреса нет, письмо получают только кураторы.
        groups: dict[str, list[tuple[Notification, Assignment, Run]]] = defaultdict(list)
        unmapped = set()
        for note, assignment, run in rows:
            personal = personal_address(assignment.assignee, book)
            if personal is None:
                unmapped.add(assignment.assignee)
                if not copies:
                    continue
            groups[personal or ""].append((note, assignment, run))
        stats["unmapped"] = sorted(unmapped)
        if not groups:
            return stats
        try:
            client = connect(settings)
        except (OSError, smtplib.SMTPException) as exc:
            error = describe(exc)
            logger.error("Напоминания не отправлены: %s", error)
            for items in groups.values():
                record(db, [note for note, _, _ in items], "failed", [], error)
            return {**stats, "failed": len(groups), "error": error}
        with client:
            for personal, items in groups.items():
                to = [personal] if personal else copies
                cc = [address for address in copies if address.casefold() != personal.casefold()] if personal else []
                notes = [note for note, _, _ in items]
                try:
                    client.send_message(compose(settings, to, cc, items, current))
                except (OSError, smtplib.SMTPException) as exc:
                    stats["failed"] += 1
                    stats["error"] = describe(exc)
                    logger.error("Напоминание для %s не отправлено: %s", ", ".join(to), stats["error"])
                    record(db, notes, "failed", to + cc, stats["error"])
                    continue
                stats["sent"] += 1
                record(db, notes, "sent", to + cc, None)
        logger.info("Напоминания по почте: отправлено %s, ошибок %s", stats["sent"], stats["failed"])
        return stats


def send_test(settings: Settings, to: str):
    message = EmailMessage()
    message["Subject"] = "Siqyr AI · проверка почты"
    message["From"] = formataddr(("Siqyr AI", sender(settings)))
    message["To"] = to
    message.set_content("Настройки SMTP работают: напоминания о сроках поручений будут приходить с этого адреса.")
    with connect(settings) as client:
        client.send_message(message)


if __name__ == "__main__":
    from . import config
    if len(sys.argv) != 2 or "@" not in sys.argv[1]:
        sys.exit("Использование: python -m backend.app.mailer you@example.com")
    if not config.settings.smtp_host:
        sys.exit("Почта не настроена: задайте в .env SMTP_HOST или RESEND_API_KEY.")
    try:
        send_test(config.settings, sys.argv[1])
    except MailError as exc:
        sys.exit(str(exc))
    except (OSError, smtplib.SMTPException) as exc:
        sys.exit(describe(exc))
    print(f"Письмо отправлено на {sys.argv[1]} через {config.settings.smtp_host}:{config.settings.smtp_port} ({security(config.settings)}).")
