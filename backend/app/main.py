"""Siqyr AI API; use one worker for in-process SSE fanout."""
from __future__ import annotations

import asyncio
import json
import re
from contextlib import asynccontextmanager
from datetime import date
from pathlib import Path

from fastapi import FastAPI, File, Form, Header, HTTPException, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from pydantic import ValidationError
from sqlmodel import select

from backend.shared.schemas import Participant
from . import config, llm
from .config import Settings, today
from .demo import demo_meeting
from .exports import export_protocol
from .limits import RequestLimits
from .models import Assignment, Notification, Run
from .pipeline import Runtime
from .reminders import assignment_view, check_reminders, reminder_loop
from .schemas import Approval, AssignmentUpdate
from .seed import seed_history

AUDIO_EXTENSIONS = {".wav", ".mp3", ".m4a", ".aac", ".ogg", ".opus", ".flac", ".mp4", ".webm", ".mov", ".avi", ".mkv", ".mpeg", ".mpg", ".wma"}


def parse_participants(raw: str | None, defaults: list[dict]) -> list[dict]:
    if raw is None:
        return defaults
    try:
        raw = raw.strip()
        values = json.loads(raw) if raw.startswith(("[", "{")) else [n.strip() for n in raw.split(",") if n.strip()]
        if not isinstance(values, list):
            raise ValueError()
        participants = [Participant.model_validate({"name": value} if isinstance(value, str) else value) for value in values]
        if any(not p.name.strip() for p in participants):
            raise ValueError()
        return [p.model_copy(update={"name": p.name.strip()}).model_dump() for p in participants]
    except (ValueError, TypeError, ValidationError):
        raise HTTPException(400, "Участники: укажите JSON-массив имён/объектов или имена через запятую.") from None


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or config.settings

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        runtime = Runtime(settings)
        app.state.runtime = runtime
        llm.configure(runtime.llm)
        try:
            if settings.seed:
                seed_history(runtime.db, settings)
            await runtime.recover_interrupted()
            if settings.reminder_interval_sec > 0:
                runtime.spawn(reminder_loop(runtime.db, settings))
            yield
        finally:
            await runtime.close()
            llm.configure(None)

    app = FastAPI(title="Siqyr AI", version="0.1.0", lifespan=lifespan)
    app.add_middleware(RequestLimits, settings=settings)
    app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins,
                       allow_origin_regex=settings.cors_origin_regex or None, allow_methods=["*"], allow_headers=["*"])

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, exc: RequestValidationError):
        return JSONResponse(status_code=400, content={"detail": "Неверные параметры запроса. Проверьте обязательные поля, типы и формат дат."})

    def runtime() -> Runtime:
        return app.state.runtime

    def require_run(run_id: str) -> Run:
        run = runtime().get_run(run_id)
        if run is None:
            raise HTTPException(404, "Совещание не найдено.")
        return run

    def run_view(run: Run) -> dict:
        with runtime().db.session() as session:
            count = len(session.exec(select(Assignment.id).where(Assignment.run_id == run.id)).all())
        return {"id": run.id, "title": run.title, "meeting_date": run.meeting_date, "status": run.status,
                "synthetic": run.synthetic, "assignments_count": count, "created_at": run.created_at}

    @app.get("/api/health")
    def health() -> dict:
        return {"status": "ok", "agent_mode": settings.agent_mode, "stt_mode": settings.stt_mode,
                "demo_mode": settings.demo_mode, "llm": "local" if settings.llm_base_url else "openai", "today": today(settings).isoformat()}

    @app.get("/api/samples")
    def samples():
        demo = demo_meeting()
        return [{key: demo[key] for key in ("id", "title", "description", "lang", "synthetic", "participants")}]

    @app.post("/api/runs", status_code=201)
    async def create_run(file: UploadFile | None = File(None), sample: str | None = Form(None),
                         title: str | None = Form(None), meeting_date: str | None = Form(None),
                         lang: str = Form("rukk"), participants: str | None = Form(None)):
        if (file is None) == (sample is None):
            raise HTTPException(400, "Загрузите файл или выберите образец demo — ровно один источник.")
        if sample is not None and sample != "demo":
            raise HTTPException(400, "Неизвестный образец. Выберите demo.")
        if lang not in {"rukk", "kk", "ru"}:
            raise HTTPException(400, "Язык должен быть ru, kk или rukk.")
        try:
            if meeting_date is not None and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", meeting_date):
                raise ValueError()
            meeting_day = date.fromisoformat(meeting_date) if meeting_date else today(settings)
        except ValueError:
            raise HTTPException(400, "Дата совещания должна быть в формате ГГГГ-ММ-ДД.") from None
        fixture = demo_meeting()
        names = parse_participants(participants, fixture["participants"] if sample else [])
        resolved_title = title.strip() if title is not None else fixture["title"] if sample else "Загруженное совещание"
        if not resolved_title or len(resolved_title) > 300:
            raise HTTPException(400, "Название должно содержать от 1 до 300 символов.")
        run = Run(title=resolved_title, meeting_date=meeting_day, lang=lang, participants=names,
                  synthetic=bool(sample or settings.stt_mode == "mock" or settings.agent_mode == "mock" or settings.demo_mode == "replay"))
        path = None
        if file is not None:
            suffix = Path(file.filename or "").suffix.lower()
            if suffix not in AUDIO_EXTENSIONS:
                raise HTTPException(415, "Неподдерживаемый формат. Загрузите аудио или видео: WAV, MP3, M4A, OGG, FLAC, MP4 или WEBM.")
            path = settings.uploads_dir / f"{run.id}{suffix}"
            total = 0
            try:
                with path.open("wb") as target:
                    while chunk := await file.read(1024 * 1024):
                        total += len(chunk)
                        if total > settings.max_upload_mb * 1024 * 1024:
                            raise HTTPException(413, f"Файл слишком большой. Максимум: {settings.max_upload_mb} МБ.")
                        target.write(chunk)
                if total == 0:
                    raise HTTPException(400, "Загруженный файл пуст.")
            except BaseException:
                path.unlink(missing_ok=True)
                raise
            finally:
                await file.close()
            run.audio_path = str(path)
        try:
            with runtime().db.session() as session:
                session.add(run)
                session.commit()
        except BaseException:
            if path:
                path.unlink(missing_ok=True)
            raise
        runtime().spawn(runtime().propose(run.id))
        return {"run_id": run.id, "status": "queued"}

    @app.get("/api/runs")
    def runs():
        with runtime().db.session() as session:
            return [run_view(run) for run in session.exec(select(Run).order_by(Run.created_at.desc())).all()]

    @app.get("/api/runs/{run_id}")
    def run_details(run_id: str):
        run = require_run(run_id)
        files = {kind: f"/api/runs/{run_id}/protocol.{kind}" if run.status == "done" else None for kind in ("docx", "pdf")}
        return {"run": run_view(run), "steps": runtime().events.steps(run_id), "proposal": run.proposal, "result": run.result, "files": files}

    @app.get("/api/runs/{run_id}/events")
    async def events(run_id: str, last_event_id: str | None = Header(None)):
        require_run(run_id)
        try:
            after = int(last_event_id or 0)
            if after < 0:
                raise ValueError()
        except ValueError:
            raise HTTPException(400, "Last-Event-ID должен быть неотрицательным целым числом.") from None
        return StreamingResponse(runtime().events.stream(run_id, after), media_type="text/event-stream",
                                 headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

    @app.post("/api/runs/{run_id}/approve")
    async def approve(run_id: str, body: Approval):
        require_run(run_id)
        if body.proposal is not None and body.proposal.run_id != run_id:
            raise HTTPException(400, "Черновик относится к другому совещанию.")
        async with runtime().events.lock:
            with runtime().db.session() as session:
                run = session.get(Run, run_id)
                if run.status != "awaiting_approval":
                    raise HTTPException(409, "Совещание сейчас не ожидает подтверждения.")
                if body.proposal is not None:
                    run.proposal = body.proposal.model_dump(mode="json")
                run.status = "executing" if body.approved else "rejected"
                session.add(run)
                session.commit()
            runtime().events.publish(run_id, "status", {"status": run.status})
        if body.approved:
            runtime().spawn(runtime().execute(run_id))
        return {"status": run.status}

    async def download(run_id: str, kind: str):
        run = require_run(run_id)
        if run.status != "done":
            raise HTTPException(409, "Протокол доступен после утверждения и завершения обработки.")
        path = settings.exports_dir / run_id / f"protocol.{kind}"
        if not path.is_file():
            try:
                path = await asyncio.to_thread(export_protocol, run, settings, kind)
            except RuntimeError as exc:
                raise HTTPException(500, str(exc)) from None
        media = "application/pdf" if kind == "pdf" else "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        return FileResponse(path, media_type=media, filename=f"protocol-{run_id}.{kind}")

    @app.get("/api/runs/{run_id}/protocol.docx")
    async def docx(run_id: str):
        return await download(run_id, "docx")

    @app.get("/api/runs/{run_id}/protocol.pdf")
    async def pdf(run_id: str):
        return await download(run_id, "pdf")

    @app.get("/api/assignments")
    def assignments(status: str | None = None, assignee: str | None = None, run_id: str | None = None):
        if status is not None and status not in {"in_progress", "overdue", "done"}:
            raise HTTPException(400, "Статус поручения должен быть in_progress, overdue или done.")
        with runtime().db.session() as session:
            statement = select(Assignment, Run).join(Run).where(Run.status == "done")
            if assignee is not None:
                statement = statement.where(Assignment.assignee == assignee)
            if run_id is not None:
                statement = statement.where(Assignment.run_id == run_id)
            items = [assignment_view(item, run.title, settings) for item, run in session.exec(statement).all()]
        return [item for item in items if status is None or item["status"] == status]

    @app.patch("/api/assignments/{assignment_id}")
    def update_assignment(assignment_id: str, body: AssignmentUpdate):
        with runtime().db.session() as session:
            item = session.get(Assignment, assignment_id)
            if item is None:
                raise HTTPException(404, "Поручение не найдено.")
            item.done = body.done
            session.add(item)
            session.commit()
            return assignment_view(item, session.get(Run, item.run_id).title, settings)

    @app.get("/api/notifications")
    def notifications(recipient: str | None = None):
        with runtime().db.session() as session:
            statement = select(Notification).order_by(Notification.created_at.desc())
            if recipient is not None:
                statement = statement.where(Notification.recipient == recipient)
            return [n.model_dump(exclude={"day"}) for n in session.exec(statement).all()]

    @app.post("/api/reminders/run")
    def reminders():
        return check_reminders(runtime().db, settings)

    return app


app = create_app()
