"""Jira: поручения утверждённого протокола становятся задачами в трекере заказчика.

Отправляет только секретарь, явной кнопкой, из immutable approved snapshot; модель в Jira ничего не пишет.
REST API v2 одинаков для Jira Data Center (PAT -> Bearer) и Jira Cloud (email + API token -> Basic).
Cloud — внешний сервис: включается JIRA_ALLOW_CLOUD=1 и только для собственных сценарных записей (AGENTS.md).
"""
from __future__ import annotations

import asyncio
import json
from datetime import timedelta, timezone
from pathlib import Path
from typing import Callable
from urllib.parse import urlparse

import httpx
from fastapi import Depends, FastAPI, HTTPException
from sqlmodel import select

from backend.shared.schemas import AssignmentDraft, Proposal
from .auth import Principal
from .config import Settings
from .exports import export_protocol
from .models import JiraIssue, Run

PRIORITIES = {"high": "High", "normal": "Medium", "low": "Low"}
OPTIONAL = {"priority", "duedate", "assignee", "labels"}  # могут отсутствовать на экране создания проекта


class JiraError(RuntimeError):
    pass


def is_cloud(url: str) -> bool:
    host = urlparse(url).hostname or ""
    return host.endswith(".atlassian.net") or host.endswith(".jira.com")


def clock(seconds: float) -> str:
    return f"{int(seconds) // 60:02d}:{int(seconds) % 60:02d}"


def description(item: AssignmentDraft, proposal: Proposal, run: Run, settings: Settings, assigned: bool) -> str:
    """Wiki markup API v2: поручение, сказанный срок и ссылки на секунды записи."""
    owner = item.assignee or "не указан"
    if item.assignee and not assigned:
        owner += " (не сопоставлен с пользователем Jira — назначьте вручную)"
    deadline = item.deadline.strftime("%d.%m.%Y") if item.deadline else "не указан"
    if item.deadline_text:
        deadline += f" — сказано: «{item.deadline_text}»"
    lines = [item.task, "", f"*Исполнитель по протоколу:* {owner}", f"*Срок по протоколу:* {deadline}"]
    segments = run.segments or []
    quotes, seen = [], set()
    for evidence in item.evidence:
        if evidence.segment_index in seen or evidence.segment_index >= len(segments):
            continue
        seen.add(evidence.segment_index)
        segment = segments[evidence.segment_index]
        start = evidence.start if evidence.start is not None else segment["start"]
        end = evidence.end if evidence.end is not None else segment["end"]
        quote = f"bq. «{evidence.quote}»"
        if run.audio_path:
            quote += f" [▶ {clock(start)}–{clock(end)}|{settings.public_api_url}/api/runs/{run.id}/audio#t={start:.1f},{end:.1f}]"
        quotes.append(quote)
    if quotes:
        lines += ["", "*Источник в записи совещания:*", *quotes]
    meeting = run.meeting_date.strftime("%d.%m.%Y") if run.meeting_date else "дата не указана"
    local = timezone(timedelta(hours=settings.utc_offset_hours))  # SQLite отдаёт naive UTC
    approved = (run.approved_at.replace(tzinfo=run.approved_at.tzinfo or timezone.utc).astimezone(local).strftime(
        f"%d.%m.%Y %H:%M UTC+{settings.utc_offset_hours}") if run.approved_at else "—")
    lines += ["", "----", f"Протокол «{run.title}», совещание {meeting}. Утверждён секретарём {approved}, редакция {proposal.revision}.",
              "Создано Siqyr AI по подтверждению секретаря."]
    if settings.public_app_url:
        lines.append(f"[Открыть совещание в Siqyr AI|{settings.public_app_url}/meetings/{run.id}]")
    return "\n".join(lines)


class Jira:
    def __init__(self, settings: Settings, transport: httpx.AsyncBaseTransport | None = None):
        self.settings = settings
        self.cloud = is_cloud(settings.jira_url)
        headers = {"Accept": "application/json"}
        if not settings.jira_email:
            headers["Authorization"] = f"Bearer {settings.jira_token}"  # Data Center PAT
        auth = (settings.jira_email, settings.jira_token) if settings.jira_email else None
        self.http = httpx.AsyncClient(base_url=settings.jira_url, headers=headers, auth=auth, timeout=20, transport=transport)
        try:
            self.users = {k.casefold(): v for k, v in json.loads(settings.jira_users or "{}").items()}
        except (ValueError, AttributeError):
            raise JiraError("JIRA_USERS должен быть JSON-объектом {\"имя\": \"email или логин\"}.") from None

    async def close(self):
        await self.http.aclose()

    async def call(self, method: str, path: str, **kwargs) -> httpx.Response:
        try:
            response = await self.http.request(method, path, **kwargs)
        except httpx.HTTPError as exc:
            raise JiraError(f"Jira недоступна ({exc.__class__.__name__}). Проверьте JIRA_URL и сеть.") from None
        if response.status_code in (401, 403):
            raise JiraError("Jira отклонила учётные данные: проверьте JIRA_EMAIL/JIRA_TOKEN и права на проект.")
        return response

    async def issue_type(self) -> dict:
        # По id: в team-managed и русской Jira имена типов неоднозначны или переведены.
        response = await self.call("GET", f"/rest/api/2/issue/createmeta/{self.settings.jira_project}/issuetypes")
        if response.status_code == 200:
            data = response.json()
            for item in data.get("issueTypes") or data.get("values") or []:
                if item.get("name", "").casefold() == self.settings.jira_issue_type.casefold():
                    return {"id": item["id"]}
        return {"name": self.settings.jira_issue_type}

    async def find_user(self, name: str | None) -> str | None:
        """Ровно один подходящий исполнитель — назначаем; иначе не угадываем."""
        if not name:
            return None
        query = self.users.get(name.casefold(), name)
        params = {"project": self.settings.jira_project, "query" if self.cloud else "username": query}
        response = await self.call("GET", "/rest/api/2/user/assignable/search", params=params)
        found = response.json() if response.status_code == 200 else []
        if len(found) != 1:
            return None
        return found[0].get("accountId" if self.cloud else "name")

    async def create(self, fields: dict) -> dict:
        while True:
            response = await self.call("POST", "/rest/api/2/issue", json={"fields": fields})
            if response.status_code == 201:
                return response.json()
            try:
                body = response.json()
            except ValueError:
                body = {}
            errors = body.get("errors") or {}
            dropped = [name for name in errors if name in OPTIONAL and name in fields]
            if response.status_code != 400 or not dropped:
                messages = [*errors.values(), *(body.get("errorMessages") or [])] or [response.text[:200]]
                raise JiraError("Jira не создала задачу: " + "; ".join(map(str, messages)))
            for name in dropped:  # поля нет на экране проекта — создаём без него
                fields.pop(name)

    async def attach(self, key: str, path: Path) -> bool:
        response = await self.call("POST", f"/rest/api/2/issue/{key}/attachments", headers={"X-Atlassian-Token": "no-check"},
                                   files={"file": (path.name, path.read_bytes(), "application/pdf")})
        return response.status_code == 200

    async def to_active_sprint(self, keys: list[str]) -> str | None:
        if not self.settings.jira_board_id or not keys:
            return None
        response = await self.call("GET", f"/rest/agile/1.0/board/{self.settings.jira_board_id}/sprint", params={"state": "active"})
        sprints = response.json().get("values", []) if response.status_code == 200 else []
        if not sprints:
            return None
        response = await self.call("POST", f"/rest/agile/1.0/sprint/{sprints[0]['id']}/issue", json={"issues": keys})
        return sprints[0].get("name") if response.status_code == 204 else None


def register_jira_routes(app: FastAPI, settings: Settings, principal: Callable, require_run: Callable):
    locks: dict[str, asyncio.Lock] = {}
    configured = bool(settings.jira_url and settings.jira_project and settings.jira_token)

    def links(run_id: str) -> list[dict]:
        with app.state.runtime.db.session() as session:
            rows = session.exec(select(JiraIssue).where(JiraIssue.run_id == run_id).order_by(JiraIssue.position)).all()
        return [{"position": r.position, "key": r.key, "url": r.url, "assigned": r.assignee is not None} for r in rows]

    async def protocol_pdf(run: Run) -> Path | None:
        if run.status != "done":
            return None
        path = settings.exports_dir / run.id / "protocol.pdf"
        if not path.is_file():
            try:
                path = await asyncio.to_thread(export_protocol, run, settings, "pdf")
            except RuntimeError:
                return None
        return path

    async def send(run: Run) -> dict:
        proposal = Proposal.model_validate(run.approved)
        done = {link["position"] for link in links(run.id)}
        pdf = await protocol_pdf(run)
        jira = Jira(settings, getattr(app.state, "jira_transport", None))
        created, issue_type = [], None
        try:
            for position, item in enumerate(proposal.assignments):
                if item.review_status == "excluded" or position in done:
                    continue
                issue_type = issue_type or await jira.issue_type()
                account = await jira.find_user(item.assignee)
                labels = ["siqyr", f"siqyr-{run.id[:8]}"] + ([] if account else ["siqyr-owner-check"]) + ([] if item.deadline else ["siqyr-deadline-check"])
                fields = {"project": {"key": settings.jira_project}, "issuetype": issue_type, "summary": " ".join(item.task.split())[:250],
                          "description": description(item, proposal, run, settings, account is not None), "labels": labels,
                          "priority": {"name": PRIORITIES.get(item.priority, "Medium")}}
                if item.deadline:
                    fields["duedate"] = item.deadline.isoformat()
                if account:
                    fields["assignee"] = {"accountId": account} if jira.cloud else {"name": account}
                key = (await jira.create(fields))["key"]
                with app.state.runtime.db.session() as session:  # сразу: повтор после сбоя не создаст дубль
                    session.add(JiraIssue(run_id=run.id, position=position, key=key, url=f"{settings.jira_url}/browse/{key}",
                                          assignee=account if "assignee" in fields else None))
                    session.commit()
                if pdf:
                    await jira.attach(key, pdf)
                created.append(key)
            sprint = await jira.to_active_sprint(created)
        finally:
            await jira.close()
        return {"project": settings.jira_project, "created": created, "sprint": sprint, "issues": links(run.id)}

    @app.get("/api/runs/{run_id}/jira")
    def jira_links(run_id: str, actor: Principal = Depends(principal)):
        require_run(run_id, actor)
        return {"configured": configured, "project": settings.jira_project or None, "issues": links(run_id)}

    @app.post("/api/runs/{run_id}/jira")
    async def jira_push(run_id: str, actor: Principal = Depends(principal)):
        run = require_run(run_id, actor)
        actor.require(run.department_id, "approve")
        if not configured:
            raise HTTPException(503, "Jira не настроена: задайте JIRA_URL, JIRA_PROJECT и JIRA_TOKEN в .env.")
        if is_cloud(settings.jira_url) and not settings.jira_allow_cloud:
            raise HTTPException(503, "Jira Cloud — внешний сервис: поручения встреч туда не отправляются. "
                                     "Для собственной сценарной записи включите JIRA_ALLOW_CLOUD=1.")
        if not run.approved:
            raise HTTPException(409, "В Jira отправляются только поручения утверждённого протокола.")
        async with locks.setdefault(run_id, asyncio.Lock()):
            try:
                return await send(require_run(run_id, actor))
            except JiraError as exc:
                raise HTTPException(502, str(exc)) from None
