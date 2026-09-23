"""Siqyr AI API; use one worker for in-process SSE fanout."""
from __future__ import annotations

import asyncio
import base64
import json
import mimetypes
import re
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from openai import OpenAIError
from pydantic import ValidationError
from sqlalchemy import update
from sqlmodel import select
import httpx

from backend.shared.schemas import Participant, Proposal, Segment, StepEvent
from . import config, llm, media
from .auth import Auth, Principal, hash_password, ROLES
from .config import Settings, today
from .demo import demo_meeting
from .exports import export_protocol
from .limits import RequestLimits
from .mailer import send_due
from .models import Assignment, Department, EcpChallenge, EmailDelivery, ExternalIdentity, Membership, Notification, Organization, Run, User, utcnow
from .pipeline import Runtime
from .readiness import as_dicts, blocking as unready
from .rag import RagEngine
from .rag_models import RagConversation, RagMessage
from .rag_schemas import BrowserSync, ChatAsk, ChatConversationCreate, ChatConversationUpdate
from .jira import register_jira_routes
from .profile import register_profile_routes
from .profile_models import bump_token_version
from .reminders import assignment_view, check_reminders, reminder_loop
from .review import ProposalError, blocking, check_proposal, confirm_reviewed, unconfirmed_speakers
from .schemas import Approval, AssignmentUpdate, DepartmentCreate, IdentityLink, Login, MembershipCreate, ProposalSave, UserCreate, UserUpdate, EcpSignature
from .seed import seed_history

UPLOAD_CHUNK = 1024 * 1024


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
        app.state.auth = Auth(settings, runtime.db)
        app.state.rag = RagEngine(runtime.db, settings)
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

    def auth() -> Auth:
        return app.state.auth

    def principal(authorization: str | None = Header(None)) -> Principal:
        return auth().identify(authorization)

    def rag() -> RagEngine:
        return app.state.rag

    def require_run(run_id: str, actor: Principal) -> Run:
        run = runtime().get_run(run_id)
        if run is None or not actor.can(run.department_id):
            raise HTTPException(404, "Совещание не найдено.")
        return run

    def run_view(run: Run) -> dict:
        with runtime().db.session() as session:
            count = len(session.exec(select(Assignment.id).where(Assignment.run_id == run.id)).all())
        return {"id": run.id, "department_id": run.department_id, "title": run.title, "meeting_date": run.meeting_date,
                "meeting_date_verified": run.meeting_date_verified, "status": run.status, "synthetic": run.synthetic,
                "source_mode": run.source_mode, "assignments_count": count, "created_at": run.created_at}

    def raw_segments(run: Run) -> list[Segment]:
        return [Segment.model_validate(s) for s in run.segments or (run.proposal or {}).get("segments", [])]

    def edited(run: Run, draft: Proposal, current: Proposal) -> Proposal:
        """Validate a human edit against the raw transcript and bump the server revision."""
        try:
            checked = check_proposal(draft, raw_segments(run), strict=True, date_verified=run.meeting_date_verified)
        except ProposalError as exc:
            raise HTTPException(422, str(exc)) from None
        return checked.model_copy(update={"run_id": run.id, "revision": current.revision + 1, "source_mode": current.source_mode})

    @app.get("/api/health")
    def health() -> dict:
        rag_health = rag().ai.health()
        return {"status": "ok", "agent_mode": settings.agent_mode, "stt_mode": settings.stt_mode,
                "demo_mode": settings.demo_mode, "auth_mode": settings.auth_mode, "llm": "configured" if settings.llm_base_url else "unconfigured",
                "llm_provider": settings.llm_provider, "llm_model": settings.model_main, "today": today(settings).isoformat(),
                "email": "configured" if settings.smtp_host else "unconfigured",
                "ready": not unready(settings), "problems": as_dicts(unready(settings)),
                "rag": {"service": rag_health is not None, "models_present": bool(rag_health and rag_health.get("models_present")),
                        "llm_local": bool(rag_health and rag_health.get("llm_local"))}}

    def user_view(actor: Principal) -> dict:
        return {"id": actor.user.id, "username": actor.user.username, "display_name": actor.user.display_name,
                "is_system_admin": actor.user.is_system_admin, "departments": actor.memberships}

    @app.post("/api/auth/login")
    def login(body: Login):
        token, actor = auth().login(body.username, body.password)
        return {"access_token": token, "token_type": "bearer", "expires_in": settings.jwt_ttl_minutes * 60,
                "user": user_view(actor)}

    @app.get("/api/auth/me")
    def me(actor: Principal = Depends(principal)):
        return user_view(actor)

    @app.get("/api/departments")
    def departments(actor: Principal = Depends(principal)):
        with runtime().db.session() as session:
            return [d.model_dump() for d in session.exec(select(Department)).all() if actor.can(d.id)]

    def system_admin(actor: Principal) -> None:
        if not actor.user.is_system_admin:
            raise HTTPException(403, "Требуются права системного администратора.")

    @app.post("/api/admin/departments", status_code=201)
    def create_department(body: DepartmentCreate, actor: Principal = Depends(principal)):
        system_admin(actor)
        with runtime().db.session() as session:
            if session.get(Department, body.id):
                raise HTTPException(409, "Департамент уже существует.")
            if not session.get(Organization, body.organization_id):
                raise HTTPException(400, "Организация не найдена.")
            if body.parent_id:
                parent = session.get(Department, body.parent_id)
                if not parent or parent.organization_id != body.organization_id:
                    raise HTTPException(400, "Родительский департамент не найден в организации.")
            department = Department(**body.model_dump())
            session.add(department)
            session.commit()
            return department.model_dump()

    @app.post("/api/admin/users", status_code=201)
    def create_user(body: UserCreate, actor: Principal = Depends(principal)):
        system_admin(actor)
        if not body.password and settings.auth_mode == "local":
            raise HTTPException(400, "Для локального входа нужен пароль.")
        try:
            password_hash = hash_password(body.password) if body.password else None
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from None
        with runtime().db.session() as session:
            if session.exec(select(User).where(User.username == body.username)).first():
                raise HTTPException(409, "Логин уже существует.")
            user = User(username=body.username, display_name=body.display_name,
                        password_hash=password_hash, is_system_admin=body.is_system_admin)
            session.add(user)
            session.commit()
            return {"id": user.id, "username": user.username, "display_name": user.display_name}

    @app.post("/api/admin/memberships", status_code=201)
    def create_membership(body: MembershipCreate, actor: Principal = Depends(principal)):
        system_admin(actor)
        if body.role not in ROLES:
            raise HTTPException(400, "Неизвестная роль.")
        with runtime().db.session() as session:
            if not session.get(User, body.user_id) or not session.get(Department, body.department_id):
                raise HTTPException(400, "Пользователь или департамент не найден.")
            existing = session.exec(select(Membership).where(Membership.user_id == body.user_id,
                Membership.department_id == body.department_id)).first()
            if existing:
                existing.role = body.role
                membership = existing
            else:
                membership = Membership(**body.model_dump())
            session.add(membership)
            session.commit()
            return membership.model_dump()

    @app.patch("/api/admin/users/{user_id}")
    def update_user(user_id: str, body: UserUpdate, actor: Principal = Depends(principal)):
        system_admin(actor)
        if body.active is None and body.password is None:
            raise HTTPException(400, "Укажите active или password.")
        if user_id == actor.user.id and body.active is False:
            raise HTTPException(400, "Нельзя отключить собственную учётную запись.")
        try:
            password_hash = hash_password(body.password) if body.password is not None else None
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from None
        with runtime().db.session() as session:
            user = session.get(User, user_id)
            if user is None:
                raise HTTPException(404, "Пользователь не найден.")
            if body.active is not None:
                user.active = body.active
            if password_hash is not None:
                user.password_hash = password_hash
                bump_token_version(session, user.id)
            session.add(user)
            session.commit()
            return {"id": user.id, "username": user.username, "active": user.active}

    @app.post("/api/admin/identities", status_code=201)
    def link_identity(body: IdentityLink, actor: Principal = Depends(principal)):
        system_admin(actor)
        if body.provider not in {"keycloak", "ecp"}:
            raise HTTPException(400, "Провайдер должен быть keycloak или ecp.")
        with runtime().db.session() as session:
            if not session.get(User, body.user_id):
                raise HTTPException(400, "Пользователь не найден.")
            existing = session.exec(select(ExternalIdentity).where(ExternalIdentity.provider == body.provider,
                ExternalIdentity.subject == body.subject)).first()
            if existing:
                raise HTTPException(409, "Эта внешняя учётная запись уже привязана.")
            identity = ExternalIdentity(**body.model_dump())
            session.add(identity)
            session.commit()
            return {"id": identity.id, "provider": identity.provider, "user_id": identity.user_id}

    @app.post("/api/auth/ecp/challenge")
    def ecp_challenge():
        if not settings.ecp_verify_url:
            raise HTTPException(503, "Вход по ЭЦП ещё не настроен.")
        challenge = EcpChallenge(payload="", expires_at=datetime.now(timezone.utc) + timedelta(minutes=3))
        challenge.payload = f"siqyr-ai:login:{challenge.id}:{int(challenge.expires_at.timestamp())}"
        with runtime().db.session() as session:
            session.add(challenge)
            session.commit()
        return {"challenge_id": challenge.id, "data_base64": base64.b64encode(challenge.payload.encode()).decode(),
                "expires_at": challenge.expires_at.isoformat()}

    @app.post("/api/auth/ecp/verify")
    async def ecp_verify(body: EcpSignature):
        if not settings.ecp_verify_url:
            raise HTTPException(503, "Вход по ЭЦП ещё не настроен.")
        with runtime().db.session() as session:
            challenge = session.get(EcpChallenge, body.challenge_id)
        if challenge is None or challenge.consumed or challenge.expires_at.replace(tzinfo=timezone.utc) <= datetime.now(timezone.utc):
            raise HTTPException(401, "Вызов ЭЦП истёк или уже использован.")
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                response = await client.post(settings.ecp_verify_url, json={"cms": body.cms, "payload": challenge.payload})
                response.raise_for_status()
                proof = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise HTTPException(503, "Сервис проверки ЭЦП недоступен.") from exc
        if not (isinstance(proof, dict) and proof.get("valid") is True and proof.get("certificate_valid") is True
                and proof.get("revocation_checked") is True and proof.get("payload") == challenge.payload
                and isinstance(proof.get("subject"), str) and proof["subject"]):
            raise HTTPException(401, "Подпись ЭЦП не прошла проверку.")
        user = auth().by_external_identity("ecp", proof["subject"])
        if user is None or not user.active:
            raise HTTPException(401, "Сертификат не привязан к активному пользователю.")
        with runtime().db.session() as session:
            result = session.exec(update(EcpChallenge).where(EcpChallenge.id == body.challenge_id,
                EcpChallenge.consumed == False).values(consumed=True))  # noqa: E712
            if result.rowcount != 1:
                raise HTTPException(401, "Вызов ЭЦП уже использован.")
            session.commit()
        return {"access_token": auth().issue(user), "token_type": "bearer",
                "expires_in": settings.jwt_ttl_minutes * 60, "user": user_view(auth().principal(user))}

    @app.get("/api/formats")
    def formats() -> dict:
        """Какие записи принимает POST /api/runs: фронт берёт отсюда accept и подсказку."""
        return media.formats_view(settings.max_upload_mb)

    @app.get("/api/samples")
    def samples(actor: Principal = Depends(principal)):
        demo = demo_meeting()
        return [{key: demo[key] for key in ("id", "title", "description", "lang", "synthetic", "participants")}]

    @app.post("/api/runs", status_code=201)
    async def create_run(file: UploadFile | None = File(None), sample: str | None = Form(None),
                         title: str | None = Form(None), meeting_date: str | None = Form(None),
                         lang: str = Form("rukk"), participants: str | None = Form(None),
                         department_id: str = Form("default"), actor: Principal = Depends(principal)):
        actor.require(department_id, "write")
        with runtime().db.session() as session:
            if session.get(Department, department_id) is None:
                raise HTTPException(400, "Департамент не найден.")
            queued = len(session.exec(select(Run.id).where(Run.status == "queued")).all())
        if missing := unready(settings):
            # Fail before accepting a file: weights are never downloaded at run time.
            raise HTTPException(503, "Модель недоступна: " + "; ".join(c.detail for c in missing))
        if queued >= settings.max_queue:
            raise HTTPException(429, f"В очереди уже {queued} совещания: дождитесь обработки.", headers={"Retry-After": "30"})
        if (file is None) == (sample is None):
            raise HTTPException(400, "Загрузите файл или выберите образец demo — ровно один источник.")
        if sample is not None and sample != "demo":
            raise HTTPException(400, "Неизвестный образец. Выберите demo.")
        if lang not in {"rukk", "kk", "ru"}:
            raise HTTPException(400, "Язык должен быть ru, kk или rukk.")
        try:
            if meeting_date and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", meeting_date):
                raise ValueError()
            meeting_day = date.fromisoformat(meeting_date) if meeting_date else None
        except ValueError:
            raise HTTPException(400, "Дата совещания должна быть в формате ГГГГ-ММ-ДД.") from None
        fixture = demo_meeting()
        if meeting_day is None and sample:
            meeting_day = date.fromisoformat(fixture["reference_meeting_date"])  # the synthetic script defines its date
        names = parse_participants(participants, fixture["participants"] if sample else [])
        resolved_title = title.strip() if title is not None else fixture["title"] if sample else "Загруженное совещание"
        if not resolved_title or len(resolved_title) > 300:
            raise HTTPException(400, "Название должно содержать от 1 до 300 символов.")
        # Unknown date stays unknown: no silent «today», relative deadlines are not normalized.
        run = Run(title=resolved_title, meeting_date=meeting_day, meeting_date_verified=meeting_day is not None, lang=lang,
                  participants=names, department_id=department_id, synthetic=bool(sample))
        path = None
        if file is not None:
            try:
                # Имя и MIME проверяются до чтения, сигнатура контейнера — по первому чанку до записи на диск.
                try:
                    suffix = media.check_declared(file.filename, file.content_type)
                    chunk = await file.read(UPLOAD_CHUNK)
                    if not chunk:
                        raise HTTPException(400, "Загруженный файл пуст.")
                    suffix = media.check_content(suffix, chunk)
                except media.UnsupportedRecording as exc:
                    raise HTTPException(415, str(exc)) from None
                path = settings.uploads_dir / f"{run.id}{suffix}"
                total = 0
                try:
                    with path.open("wb") as target:
                        while chunk:
                            total += len(chunk)
                            if total > settings.max_upload_mb * 1024 * 1024:
                                raise HTTPException(413, f"Файл слишком большой. Максимум: {settings.max_upload_mb} МБ.")
                            target.write(chunk)
                            chunk = await file.read(UPLOAD_CHUNK)
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

    @app.post("/api/runs/recordings", status_code=201)
    async def create_recording(title: str = Form(...), meeting_date: str | None = Form(None),
                               lang: str = Form("rukk"), department_id: str = Form("default"),
                               actor: Principal = Depends(principal)):
        actor.require(department_id, "write")
        if missing := unready(settings):
            raise HTTPException(503, "Модель недоступна: " + "; ".join(c.detail for c in missing))
        if lang not in {"rukk", "kk", "ru"}:
            raise HTTPException(400, "Язык должен быть ru, kk или rukk.")
        if not title.strip() or len(title.strip()) > 300:
            raise HTTPException(400, "Название должно содержать от 1 до 300 символов.")
        try:
            meeting_day = date.fromisoformat(meeting_date) if meeting_date else None
        except ValueError:
            raise HTTPException(400, "Дата совещания должна быть в формате ГГГГ-ММ-ДД.") from None
        with runtime().db.session() as session:
            if session.get(Department, department_id) is None:
                raise HTTPException(400, "Департамент не найден.")
            run = Run(title=title.strip(), meeting_date=meeting_day, meeting_date_verified=meeting_day is not None,
                      lang=lang, department_id=department_id, status="recording", synthetic=False)
            run.audio_path = str(settings.uploads_dir / f"{run.id}.webm")
            session.add(run)
            session.commit()
        Path(run.audio_path).touch()
        return {"run_id": run.id, "status": "recording"}

    @app.post("/api/runs/{run_id}/chunks")
    async def append_recording_chunk(run_id: str, request: Request, offset: int = Header(..., alias="X-Chunk-Offset"),
                                     actor: Principal = Depends(principal)):
        run = require_run(run_id, actor)
        actor.require(run.department_id, "write")
        if offset < 0:
            raise HTTPException(400, "Смещение чанка должно быть неотрицательным.")
        payload = bytearray()
        async for part in request.stream():
            payload.extend(part)
            if len(payload) > 5 * 1024 * 1024:
                raise HTTPException(413, "Один чанк записи превышает 5 МБ.")
        if not payload:
            raise HTTPException(400, "Пустой чанк.")
        async with runtime().events.lock:
            with runtime().db.session() as session:
                current = session.get(Run, run_id)
                if current.status != "recording":
                    raise HTTPException(409, "Запись уже завершена.")
                path = Path(current.audio_path)
                size = path.stat().st_size
                if offset < size and offset + len(payload) <= size:
                    with path.open("rb") as source:
                        source.seek(offset)
                        if source.read(len(payload)) == payload:
                            return {"offset": offset + len(payload)}
                if offset != size:
                    raise HTTPException(409, f"Ожидалось смещение {size} байт.")
                if size + len(payload) > settings.max_upload_mb * 1024 * 1024:
                    raise HTTPException(413, f"Запись превышает {settings.max_upload_mb} МБ.")
                with path.open("ab") as target:
                    target.write(payload)
        return {"offset": size + len(payload)}

    @app.post("/api/runs/{run_id}/finish")
    async def finish_recording(run_id: str, actor: Principal = Depends(principal)):
        run = require_run(run_id, actor)
        actor.require(run.department_id, "write")
        async with runtime().events.lock:
            with runtime().db.session() as session:
                current = session.get(Run, run_id)
                if current.status != "recording":
                    raise HTTPException(409, "Запись уже завершена.")
                if not Path(current.audio_path).is_file() or Path(current.audio_path).stat().st_size == 0:
                    raise HTTPException(400, "Запись пуста.")
                current.status = "queued"
                session.add(current)
                session.commit()
            runtime().events.publish(run_id, "status", {"status": "queued"})
        runtime().spawn(runtime().propose(run_id))
        return {"run_id": run_id, "status": "queued"}

    @app.get("/api/runs")
    def runs(actor: Principal = Depends(principal)):
        with runtime().db.session() as session:
            return [run_view(run) for run in session.exec(select(Run).order_by(Run.created_at.desc())).all() if actor.can(run.department_id)]

    @app.get("/api/runs/{run_id}")
    def run_details(run_id: str, actor: Principal = Depends(principal)):
        run = require_run(run_id, actor)
        files = {kind: f"/api/runs/{run_id}/protocol.{kind}" if run.status == "done" else None for kind in ("docx", "pdf")}
        return {"run": run_view(run), "steps": runtime().events.steps(run_id), "proposal": run.proposal, "result": run.result, "files": files,
                "revision": (run.proposal or {}).get("revision"), "approved": run.approved, "approved_at": run.approved_at,
                "transcript": {"source_mode": run.source_mode, "segments": run.segments},
                "audio": f"/api/runs/{run_id}/audio" if run.audio_path else None}

    @app.get("/api/runs/{run_id}/audio")
    def audio(run_id: str, actor: Principal = Depends(principal)):
        run = require_run(run_id, actor)
        if not run.audio_path or not Path(run.audio_path).is_file():
            raise HTTPException(404, "У этого совещания нет исходной записи.")
        # FileResponse answers Range requests, so <audio> can seek to an evidence timestamp.
        media = mimetypes.guess_type(run.audio_path)[0] or "application/octet-stream"
        return FileResponse(run.audio_path, media_type=media)

    @app.put("/api/runs/{run_id}/proposal")
    async def save_proposal(run_id: str, body: ProposalSave, actor: Principal = Depends(principal)):
        actor.require(require_run(run_id, actor).department_id, "write")
        if body.proposal.run_id != run_id:
            raise HTTPException(400, "Черновик относится к другому совещанию.")
        async with runtime().events.lock:
            with runtime().db.session() as session:
                run = session.get(Run, run_id)
                if run.status != "awaiting_approval":
                    raise HTTPException(409, "Черновик можно менять только до утверждения.")
                current = Proposal.model_validate(run.proposal)
                if body.expected_revision != current.revision:
                    raise HTTPException(409, f"Черновик уже изменён: текущая редакция {current.revision}. Обновите страницу.")
                draft = edited(run, body.proposal, current)
                run.proposal = draft.model_dump(mode="json")
                session.add(run)
                session.commit()
        await runtime().events.emit(StepEvent(run_id=run_id, type="tool_result", agent="secretary", content=f"Сохранена редакция {draft.revision}.",
                                              data={"stage": "review", "revision": draft.revision, "user_id": actor.user.id}))
        return {"revision": draft.revision, "proposal": draft.model_dump(mode="json")}

    @app.get("/api/runs/{run_id}/events")
    async def events(run_id: str, last_event_id: str | None = Header(None), actor: Principal = Depends(principal)):
        require_run(run_id, actor)
        try:
            after = int(last_event_id or 0)
            if after < 0:
                raise ValueError()
        except ValueError:
            raise HTTPException(400, "Last-Event-ID должен быть неотрицательным целым числом.") from None
        return StreamingResponse(runtime().events.stream(run_id, after), media_type="text/event-stream",
                                 headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

    @app.post("/api/runs/{run_id}/approve")
    async def approve(run_id: str, body: Approval, actor: Principal = Depends(principal)):
        actor.require(require_run(run_id, actor).department_id, "approve")
        if body.proposal is not None and body.proposal.run_id != run_id:
            raise HTTPException(400, "Черновик относится к другому совещанию.")
        async with runtime().events.lock:
            with runtime().db.session() as session:
                run = session.get(Run, run_id)
                snapshot = run.approved or {}
                if (body.approved and body.expected_revision is not None and run.status in {"executing", "done"}
                        and snapshot.get("revision") == body.expected_revision):
                    return {"status": run.status, "revision": body.expected_revision}  # same approval repeated
                if run.status != "awaiting_approval":
                    raise HTTPException(409, "Совещание сейчас не ожидает подтверждения.")
                current = Proposal.model_validate(run.proposal)
                if body.expected_revision is not None and body.expected_revision != current.revision:
                    raise HTTPException(409, f"Утверждается устаревшая редакция: текущая {current.revision}. Обновите страницу.")
                draft = edited(run, body.proposal, current) if body.proposal is not None else current
                if body.approved:
                    pending = blocking(draft)
                    if pending:
                        return JSONResponse(status_code=409, content={
                            "detail": "Нужно решение секретаря по поручениям " + ", ".join(map(str, pending)) + ": подтвердите, исправьте или исключите.",
                            "code": "review_required", "assignments": pending})
                    pending_speakers = unconfirmed_speakers(draft)
                    if pending_speakers:
                        return JSONResponse(status_code=409, content={
                            "detail": "Подтвердите связь голоса с участником: " + ", ".join(pending_speakers),
                            "code": "speaker_review_required", "speakers": pending_speakers})
                    draft = confirm_reviewed(draft)
                    run.approved = draft.model_dump(mode="json")
                    run.approved_at = utcnow()
                run.proposal = draft.model_dump(mode="json")
                run.approval_comment = body.comment
                run.status = "executing" if body.approved else "rejected"
                session.add(run)
                session.commit()
            runtime().events.publish(run_id, "status", {"status": run.status})
        await runtime().events.emit(StepEvent(run_id=run_id, type="tool_result", agent="secretary",
                                              content=f"Утверждена редакция {draft.revision}." if body.approved else "Протокол отклонён.",
                                              data={"stage": "approve", "revision": draft.revision, "approved": body.approved, "user_id": actor.user.id}))
        if body.approved:
            runtime().spawn(runtime().execute(run_id))
        return {"status": run.status, "revision": draft.revision}

    async def download(run_id: str, kind: str, actor: Principal):
        run = require_run(run_id, actor)
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
    async def docx(run_id: str, actor: Principal = Depends(principal)):
        return await download(run_id, "docx", actor)

    @app.get("/api/runs/{run_id}/protocol.pdf")
    async def pdf(run_id: str, actor: Principal = Depends(principal)):
        return await download(run_id, "pdf", actor)

    @app.get("/api/assignments")
    def assignments(status: str | None = None, assignee: str | None = None, run_id: str | None = None,
                    actor: Principal = Depends(principal)):
        if status is not None and status not in {"in_progress", "overdue", "done"}:
            raise HTTPException(400, "Статус поручения должен быть in_progress, overdue или done.")
        with runtime().db.session() as session:
            statement = select(Assignment, Run).join(Run).where(Run.status == "done")
            if assignee is not None:
                statement = statement.where(Assignment.assignee == assignee)
            if run_id is not None:
                statement = statement.where(Assignment.run_id == run_id)
            items = [assignment_view(item, run.title, settings) for item, run in session.exec(statement).all()
                     if actor.can(run.department_id)]
        return [item for item in items if status is None or item["status"] == status]

    @app.patch("/api/assignments/{assignment_id}")
    def update_assignment(assignment_id: str, body: AssignmentUpdate, actor: Principal = Depends(principal)):
        with runtime().db.session() as session:
            item = session.get(Assignment, assignment_id)
            if item is None:
                raise HTTPException(404, "Поручение не найдено.")
            run = session.get(Run, item.run_id)
            if not actor.can(run.department_id):
                raise HTTPException(404, "Поручение не найдено.")
            actor.require(run.department_id, "write")
            item.done = body.done
            session.add(item)
            session.commit()
            return assignment_view(item, session.get(Run, item.run_id).title, settings)

    @app.get("/api/notifications")
    def notifications(recipient: str | None = None, actor: Principal = Depends(principal)):
        with runtime().db.session() as session:
            statement = select(Notification).order_by(Notification.created_at.desc())
            if recipient is not None:
                statement = statement.where(Notification.recipient == recipient)
            notes = session.exec(statement).all()
            result = []
            for n in notes:
                assignment = session.get(Assignment, n.assignment_id) if n.assignment_id else None
                run = session.get(Run, n.run_id) if n.run_id else session.get(Run, assignment.run_id) if assignment else None
                if run and actor.can(run.department_id):
                    # Только статус письма: адреса и текст ошибки SMTP остаются в логе сервера.
                    delivery = session.get(EmailDelivery, n.id)
                    result.append({**n.model_dump(exclude={"day"}), "email": delivery.status if delivery else None})
            return result

    @app.post("/api/reminders/run")
    def reminders(actor: Principal = Depends(principal)):
        if not actor.user.is_system_admin:
            raise HTTPException(403, "Только системный администратор может запускать общую проверку сроков.")
        return {**check_reminders(runtime().db, settings), "email": send_due(runtime().db, settings)}

    @app.post("/api/chat/sync")
    async def sync_chat_sources(body: BrowserSync, actor: Principal = Depends(principal)):
        try:
            return await asyncio.to_thread(rag().sync_browser, actor.user.id, body.meetings)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from None
        except RuntimeError as exc:
            raise HTTPException(503, str(exc)) from None

    @app.get("/api/chat/conversations")
    def chat_conversations(actor: Principal = Depends(principal)):
        return rag().conversations(actor.user.id)

    @app.post("/api/chat/conversations", status_code=201)
    def create_chat(body: ChatConversationCreate, actor: Principal = Depends(principal)):
        if not body.title.strip():
            raise HTTPException(400, "Укажите название чата.")
        return rag().create_conversation(actor.user.id, body.title)

    @app.patch("/api/chat/conversations/{conversation_id}")
    def rename_chat(conversation_id: str, body: ChatConversationUpdate, actor: Principal = Depends(principal)):
        if not body.title.strip():
            raise HTTPException(400, "Укажите название чата.")
        return rag().rename_conversation(actor.user.id, conversation_id, body.title)

    @app.get("/api/chat/conversations/{conversation_id}")
    def chat_messages(conversation_id: str, actor: Principal = Depends(principal)):
        return {"id": conversation_id, "messages": rag().messages(actor.user.id, conversation_id)}

    @app.delete("/api/chat/conversations/{conversation_id}", status_code=204)
    def delete_chat(conversation_id: str, actor: Principal = Depends(principal)):
        with runtime().db.session() as session:
            conversation = session.get(RagConversation, conversation_id)
            if conversation is None or conversation.owner_id != actor.user.id:
                raise HTTPException(404, "Чат не найден.")
            for message in session.exec(select(RagMessage).where(RagMessage.conversation_id == conversation_id)).all():
                session.delete(message)
            session.flush()
            session.delete(conversation)
            session.commit()

    @app.post("/api/chat/messages")
    async def ask_chat(body: ChatAsk, actor: Principal = Depends(principal)):
        with runtime().db.session() as session:
            allowed = {run.id for run in session.exec(select(Run)).all() if actor.can(run.department_id)}
        try:
            return await rag().ask(actor.user.id, allowed, body.question.strip(), body.conversation_id)
        except (RuntimeError, OpenAIError) as exc:
            raise HTTPException(503, f"RAG-чат недоступен: {exc}") from None

    register_profile_routes(app, settings, principal)
    register_jira_routes(app, settings, principal, require_run)
    return app


app = create_app()
