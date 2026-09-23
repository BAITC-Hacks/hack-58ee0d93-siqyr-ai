import asyncio
import importlib
import logging
import time
from datetime import datetime
from pathlib import Path
from urllib.parse import urlsplit

from sqlmodel import select

from backend import stt
from backend.shared.schemas import Proposal, Result, RunInput, Segment, Speaker, StepEvent
from .config import Settings, today
from .db import Database
from .events import Events
from .exports import export_protocol
from .llm import LLM
from .models import Assignment, Notification, Run, utcnow
from .review import check_proposal

logger = logging.getLogger(__name__)


class Runtime:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.db = Database(settings)
        self.events = Events(self.db)
        self.llm = LLM(self.db, settings)
        self.tasks: set[asyncio.Task] = set()

    def spawn(self, coroutine):
        task = asyncio.create_task(coroutine)
        self.tasks.add(task)
        task.add_done_callback(self.tasks.discard)

    async def close(self):
        tasks = list(self.tasks)
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        await self.llm.close()
        self.db.close()

    def runner(self):
        if self.settings.agent_mode not in {"mock", "real"}:
            raise ValueError("Неизвестный режим AGENT_MODE.")
        return importlib.import_module("backend.agents.runner_mock" if self.settings.agent_mode == "mock" else "backend.agents.runner")

    def source_mode(self) -> str:
        if self.settings.demo_mode == "replay":
            return "replay"
        # Any mock stage makes the whole result mock; never label partial mocks as real.
        return "real" if self.settings.stt_mode == "real" and self.settings.agent_mode == "real" else "mock"

    def guard_llm_destination(self, run: Run):
        if self.settings.agent_mode != "real":
            return
        if not self.settings.llm_base_url:
            raise ValueError("Для реальных агентов задайте LLM_BASE_URL; облачного fallback нет.")
        if self.settings.llm_provider not in {"local", "dev_openai"}:
            raise ValueError("LLM_PROVIDER должен быть local или dev_openai.")
        hosted = urlsplit(self.settings.llm_base_url).hostname == "api.openai.com"
        if (hosted or self.settings.llm_provider == "dev_openai") and not run.synthetic:
            raise ValueError("OpenAI API разрешён только для синтетических запусков.")
        if hosted and self.settings.llm_provider == "local":
            raise ValueError("Профиль local не может указывать на OpenAI API: задайте локальный LLM_BASE_URL.")

    def get_run(self, run_id: str) -> Run:
        with self.db.session() as session:
            return session.get(Run, run_id)

    async def fail(self, run_id: str, exc: Exception):
        logger.exception("Ошибка обработки совещания %s", run_id)
        message = "Не удалось обработать совещание. Проверьте настройки STT, агентов и шрифта PDF."
        if isinstance(exc, ModuleNotFoundError):
            message = "Модуль реального режима ещё не установлен. Для демо выберите AGENT_MODE=mock и STT_MODE=mock."
        elif isinstance(exc, ValueError):
            message = str(exc)
        await self.events.emit(StepEvent(run_id=run_id, type="error", agent="orchestrator", content=message))
        await self.events.status(run_id, "error")

    async def recover_interrupted(self):
        with self.db.session() as session:
            ids = [r.id for r in session.exec(select(Run).where(Run.status.in_(["queued", "transcribing", "running", "executing"]))).all()]
        for run_id in ids:
            await self.events.emit(StepEvent(run_id=run_id, type="error", agent="orchestrator", content="Обработка прервана перезапуском сервера. Создайте новый запуск."))
            await self.events.status(run_id, "error")

    async def replay(self, run: Run) -> Proposal:
        with self.db.session() as session:
            if self.settings.replay_run_id:
                candidates = [session.get(Run, self.settings.replay_run_id)]
            else:
                candidates = session.exec(select(Run).where(Run.status == "done", Run.id != run.id).order_by(Run.created_at.desc())).all()
            source, steps = None, []
            for candidate in candidates:
                if candidate and candidate.status == "done" and candidate.proposal:
                    history = self.events.steps(candidate.id)
                    if history:
                        source, steps = candidate, history
                        break
        if source is None:
            raise ValueError("Нет завершённого запуска с шагами для повтора. Сначала выполните запуск в DEMO_MODE=live.")
        previous = None
        draft = source.proposal
        for payload in steps:
            if payload["type"] == "needs_approval":
                draft = payload["data"].get("proposal", draft)
                break
            if payload["type"] in {"final", "error"}:
                break
            timestamp = datetime.fromisoformat(payload["ts"])
            if previous is not None:
                await asyncio.sleep(min(2, max(0, (timestamp - previous).total_seconds())))
            previous = timestamp
            await self.events.emit(StepEvent.model_validate({**payload, "run_id": run.id, "seq": 0, "ts": utcnow()}))
        return Proposal.model_validate({**draft, "run_id": run.id})

    async def propose(self, run_id: str):
        try:
            run = self.get_run(run_id)
            mode = self.source_mode()
            elapsed = None
            if mode == "replay":
                await self.events.status(run_id, "running")
                proposal = await self.replay(run)
                segments = [Segment.model_validate(s) for s in proposal.segments]
            else:
                await self.events.status(run_id, "transcribing")
                await self.events.emit(StepEvent(run_id=run_id, type="agent_start", agent="stt", content="Распознаю запись и разделяю реплики участников.",
                                                 data={"stage": "transcribe", "source_mode": mode}))
                started = time.monotonic()
                segments = await asyncio.to_thread(stt.transcribe, Path(run.audio_path or "demo"), run.lang)
                with self.db.session() as session:
                    stored = session.get(Run, run_id)
                    stored.segments = [s.model_dump(mode="json") for s in segments]
                    session.add(stored)
                    session.commit()
                await self.events.emit(StepEvent(run_id=run_id, type="tool_result", agent="stt", content=f"Транскрипт готов: {len(segments)} реплик.",
                                                 data={"stage": "transcribe", "duration_ms": int((time.monotonic() - started) * 1000), "source_mode": mode,
                                                       "segments": [s.model_dump(mode="json") for s in segments]}))
                await self.events.status(run_id, "running")
                run_input = RunInput(run_id=run_id, title=run.title, meeting_date=run.meeting_date if run.meeting_date_verified else None,
                                     meeting_date_verified=run.meeting_date_verified, lang=run.lang, participants=run.participants, segments=segments)
                self.guard_llm_destination(run)
                started = time.monotonic()
                proposal = Proposal.model_validate(await self.runner().propose(run_input, self.events.emit))
                elapsed = int((time.monotonic() - started) * 1000)
            if proposal.run_id != run_id:
                raise ValueError("Агент вернул протокол другого совещания.")
            # Model output is checked against the immutable raw transcript; bad refs become review reasons.
            proposal = check_proposal(proposal, segments, strict=False, date_verified=run.meeting_date_verified)
            proposal = proposal.model_copy(update={"revision": 1, "source_mode": mode,
                                                   "speaker_records": proposal.speaker_records or speaker_records(proposal)})
            with self.db.session() as session:
                stored = session.get(Run, run_id)
                stored.segments = [s.model_dump(mode="json") for s in segments]
                stored.source_mode = mode
                stored.proposal = proposal.model_dump(mode="json")
                session.add(stored)
                session.commit()
            flagged = sum(bool(a.review_reasons) for a in proposal.assignments)
            await self.events.emit(StepEvent(run_id=run_id, type="tool_result", agent="orchestrator",
                                             content=f"Проверены источники: поручений {len(proposal.assignments)}, требуют проверки {flagged}.",
                                             data={"stage": "validate", "assignments": len(proposal.assignments), "needs_review": flagged,
                                                   **({"duration_ms": elapsed} if elapsed is not None else {})}))
            await self.events.emit(StepEvent(run_id=run_id, type="needs_approval", agent="secretary", content="Проверьте и утвердите проект протокола.",
                                             data={"stage": "review", "revision": proposal.revision, "needs_review": flagged,
                                                   "proposal": proposal.model_dump(mode="json")}))
            await self.events.status(run_id, "awaiting_approval")
        except Exception as exc:
            await self.fail(run_id, exc)

    async def execute(self, run_id: str):
        try:
            run = self.get_run(run_id)
            self.guard_llm_destination(run)
            # Only the immutable approved snapshot feeds execute, exports and the assignment register.
            proposal = Proposal.model_validate(run.approved or run.proposal)
            result = Result.model_validate(await self.runner().execute(proposal, self.events.emit))
            if result.run_id != run_id:
                raise ValueError("Агент вернул результат другого совещания.")
            await self.events.emit(StepEvent(run_id=run_id, type="tool_call", agent="orchestrator", content="Формирую DOCX и PDF утверждённой редакции.",
                                             data={"stage": "export", "revision": proposal.revision}))
            started = time.monotonic()
            for kind in ("docx", "pdf"):
                await asyncio.to_thread(export_protocol, run, self.settings, kind)
            await self.events.emit(StepEvent(run_id=run_id, type="tool_result", agent="orchestrator", content="Файлы протокола готовы.",
                                             data={"stage": "export", "revision": proposal.revision, "duration_ms": int((time.monotonic() - started) * 1000)}))
            with self.db.session() as session:
                assignments = []
                for draft in proposal.assignments:
                    if draft.review_status == "excluded":
                        continue
                    item = Assignment(run_id=run_id, assignee=draft.assignee or "Не указан",
                                      **draft.model_dump(include={"task", "deadline", "deadline_text", "priority", "category", "source_segments"}))
                    session.add(item)
                    assignments.append(item)
                session.flush()
                for excerpt in result.excerpts:
                    matching = [a for a in assignments if a.assignee == excerpt.recipient]
                    # One grouped excerpt may refer to several assignments.
                    session.add(Notification(kind="excerpt", recipient=excerpt.recipient, message=excerpt.message, run_id=run.id,
                                             assignment_id=matching[0].id if len(matching) == 1 else None, day=today(self.settings)))
                stored = session.get(Run, run_id)
                stored.result = result.model_dump(mode="json")
                session.add(stored)
                session.commit()
            await self.events.emit(StepEvent(run_id=run_id, type="final", agent="secretary", content="Протокол сохранён, поручения и выдержки подготовлены.", data={
                "stage": "complete", "revision": proposal.revision, "docx": f"/api/runs/{run_id}/protocol.docx", "pdf": f"/api/runs/{run_id}/protocol.pdf",
                "assignments": [a.model_dump(mode="json", exclude={"source_segments"}) for a in assignments],
            }))
            # Terminal status must come after the durable final step.
            await self.events.status(run_id, "done")
        except Exception as exc:
            await self.fail(run_id, exc)


def speaker_records(proposal: Proposal) -> list[Speaker]:
    """Suggested voice-to-name links; a human confirms them in review."""
    labels: dict[str, list[int]] = {}
    for index, segment in enumerate(proposal.segments):
        if segment.speaker:
            labels.setdefault(segment.speaker, []).append(index)
    return [Speaker(label=label, participant_name=proposal.speakers.get(label),
                    mapping_status="suggested" if proposal.speakers.get(label) else "unmapped", source_segments=indices)
            for label, indices in labels.items()]
