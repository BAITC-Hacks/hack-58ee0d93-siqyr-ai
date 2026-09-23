"""Почтовые напоминания против настоящего smtplib и локального SMTP-приёмника на loopback."""
import json
import socketserver
import threading
from dataclasses import replace
from email import message_from_bytes, policy

import pytest
from sqlmodel import select

from backend.app import config
from backend.app.mailer import days_word, security, send_due
from backend.app.models import EmailDelivery
from backend.app.reminders import check_reminders


class Handler(socketserver.StreamRequestHandler):
    def reply(self, line: str):
        self.wfile.write(line.encode() + b"\r\n")

    def handle(self):
        sink = self.server.sink
        self.reply("220 sink")
        sender, recipients = None, []
        while line := self.rfile.readline():
            command = line.decode().strip()
            verb = command.split(" ", 1)[0].upper()
            if verb == "EHLO":
                self.reply("250-sink")
                self.reply("250 AUTH PLAIN LOGIN")
            elif verb == "AUTH":
                sink.logins += 1
                self.reply("235 ok" if sink.auth_ok else "535 bad credentials")
            elif verb == "MAIL":
                sender, recipients = command, []
                self.reply("250 ok")
            elif verb == "RCPT":
                address = command.split(":", 1)[1].strip().strip("<>")
                sink.rcpt_attempts += 1
                if address in sink.reject:
                    self.reply("550 no such user")
                else:
                    recipients.append(address)
                    self.reply("250 ok")
            elif verb == "DATA":
                self.reply("354 go ahead")
                data = b""
                while (chunk := self.rfile.readline()) not in (b".\r\n", b""):
                    data += chunk
                sink.messages.append({"from": sender, "rcpt": recipients, "message": message_from_bytes(data, policy=policy.default)})
                self.reply("250 queued")
            elif verb == "QUIT":
                self.reply("221 bye")
                return
            else:
                self.reply("250 ok")


class Sink(socketserver.ThreadingTCPServer):
    daemon_threads = True
    allow_reuse_address = True


@pytest.fixture
def sink():
    server = Sink(("127.0.0.1", 0), Handler)
    server.sink = server
    server.messages, server.reject, server.auth_ok, server.logins, server.rcpt_attempts = [], set(), True, 0, 0
    server.port = server.server_address[1]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield server
    server.shutdown()
    server.server_close()


def mail_settings(sink, **overrides):
    return {"seed": True, "smtp_host": "127.0.0.1", "smtp_port": sink.port, "smtp_security": "none",
            "smtp_from": "siqyr@example.test", **overrides}


def body(message) -> str:
    return message.get_body(("plain",)).get_content()


def test_reminder_emails_go_to_assignee_with_curator_copy_once(client_factory, sink):
    client = client_factory(**mail_settings(sink, notify_emails=json.dumps({"ерлан демов": "erlan@example.test"}),
                                            notify_cc="boss@example.test", public_app_url="http://app.test"))
    result = client.post("/api/reminders/run").json()
    # Seed: overdue у Ерлана (есть адрес) и срок сегодня у Даны (адреса нет -> только куратору).
    assert result["created"] == 2
    assert result["email"] == {"enabled": True, "sent": 2, "failed": 0, "unmapped": ["Дана Примерова"]}
    by_rcpt = {tuple(m["rcpt"]): m["message"] for m in sink.messages}
    assert set(by_rcpt) == {("erlan@example.test", "boss@example.test"), ("boss@example.test",)}
    overdue = by_rcpt[("erlan@example.test", "boss@example.test")]
    assert overdue["Subject"].startswith("Siqyr AI · просрочено поручение: Подготовить и отправить отчёт")
    assert overdue["Cc"] == "boss@example.test"
    text = body(overdue)
    assert "просрочено на 3 дня (сказано: «жұмаға дейін»)" in text
    run_id = client.get("/api/runs").json()[0]["id"]
    assert f"http://app.test/meetings/{run_id}" in text
    assert "синтетические демонстрационные данные" in text
    assert "срок сегодня" in body(by_rcpt[("boss@example.test",)])
    assert overdue.get_body(("html",)) is not None

    # Повторная проверка в тот же день писем не дублирует; статус виден в /api/notifications.
    assert client.post("/api/reminders/run").json()["email"]["sent"] == 0
    assert len(sink.messages) == 2
    assert {n["email"] for n in client.get("/api/notifications").json()} == {"sent"}

    # На следующий день напоминание приходит снова, но не по выполненному поручению.
    overdue_id = next(a["id"] for a in client.get("/api/assignments").json() if a["status"] == "overdue")
    client.patch(f"/api/assignments/{overdue_id}", json={"done": True})
    db, tomorrow = client.app.state.runtime.db, replace(client.settings, demo_today="2026-09-24")
    check_reminders(db, tomorrow)
    assert send_due(db, tomorrow)["sent"] == 1
    assert sink.messages[-1]["rcpt"] == ["boss@example.test"]
    assert "просрочено на 1 день" in body(sink.messages[-1]["message"])


def test_refused_recipient_is_retried_then_given_up(client_factory, sink):
    sink.reject = {"erlan@example.test"}
    client = client_factory(**mail_settings(sink, notify_emails=json.dumps({"Ерлан Демов": "erlan@example.test"})))
    first = client.post("/api/reminders/run").json()["email"]
    assert first["failed"] == 1 and "erlan@example.test (550 no such user)" in first["error"]
    assert first["unmapped"] == ["Дана Примерова"]  # без NOTIFY_CC письмо без адреса не уходит никому
    for _ in range(3):
        client.post("/api/reminders/run")
    assert sink.rcpt_attempts == 3  # MAX_ATTEMPTS, дальше не пытается
    with client.app.state.runtime.db.session() as session:
        delivery = session.exec(select(EmailDelivery)).one()
    assert (delivery.status, delivery.attempts) == ("failed", 3)
    assert "failed" in {n["email"] for n in client.get("/api/notifications").json()}


def test_configuration_errors_are_explained(client_factory, sink):
    client = client_factory(**mail_settings(sink, notify_emails="не json"))
    assert "NOTIFY_EMAILS" in client.post("/api/reminders/run").json()["email"]["error"]
    assert sink.messages == []

    sink.auth_ok = False
    db = client.app.state.runtime.db
    login = replace(client.settings, notify_emails="", notify_cc="boss@example.test", smtp_user="bot@example.test", smtp_password="wrong")
    result = send_due(db, login)
    assert result["failed"] == 1 and "пароль приложения" in result["error"]

    closed = socketserver.TCPServer(("127.0.0.1", 0), Handler)
    port = closed.server_address[1]
    closed.server_close()
    result = send_due(db, replace(login, smtp_user="", smtp_port=port))
    assert "недоступен" in result["error"]

    assert "SMTP_SECURITY" in send_due(db, replace(login, smtp_security="tls"))["error"]
    assert "SMTP_FROM" in send_due(db, replace(login, smtp_from="", smtp_user=""))["error"]


def test_disabled_without_smtp_host(client):
    assert client.post("/api/reminders/run").json()["email"] == {"enabled": False, "sent": 0, "failed": 0, "unmapped": []}
    assert client.get("/api/health").json()["email"] == "unconfigured"


def test_resend_key_alone_uses_resend_smtp_gateway(monkeypatch):
    for key in ("SMTP_HOST", "SMTP_PORT", "SMTP_SECURITY", "SMTP_USER", "SMTP_PASSWORD", "SMTP_FROM"):
        monkeypatch.setenv(key, "")
    monkeypatch.setenv("RESEND_API_KEY", "re_test")
    resend = config.Settings()
    assert (resend.smtp_host, resend.smtp_port, resend.smtp_user, resend.smtp_password, resend.smtp_from) == (
        "smtp.resend.com", 465, "resend", "re_test", "onboarding@resend.dev")
    assert security(resend) == "ssl"
    # Свой SMTP_HOST (relay заказчика) важнее ключа Resend: ничего из Resend не подставляется.
    monkeypatch.setenv("SMTP_HOST", "relay.company.kz")
    relay = config.Settings()
    assert (relay.smtp_host, relay.smtp_port, relay.smtp_user, relay.smtp_password, relay.smtp_from) == ("relay.company.kz", 587, "", "", "")


def test_days_word():
    assert [days_word(n) for n in (1, 2, 5, 11, 12, 21, 22, 25, 111)] == [
        "1 день", "2 дня", "5 дней", "11 дней", "12 дней", "21 день", "22 дня", "25 дней", "111 дней"]
