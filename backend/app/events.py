"""Durable ordered events and live SSE for one API worker."""
import asyncio
import json
from collections import defaultdict

from fastapi import HTTPException
from sqlalchemy import func
from sqlmodel import select

from backend.shared.schemas import RunStatus, StepEvent
from .db import Database
from .models import Run, Step

TERMINAL = {"done", "rejected", "error"}
HEARTBEAT_SECONDS = 15


def frame(kind: str, payload: dict, seq: int | None = None) -> str:
    return (f"id: {seq}\n" if seq is not None else "") + (
        f"event: {kind}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"
    )


class Events:
    def __init__(self, db: Database):
        self.db = db
        self.lock = asyncio.Lock()
        self.subscribers: dict[str, set[asyncio.Queue]] = defaultdict(set)

    def publish(self, run_id: str, kind: str, payload: dict):
        for queue in self.subscribers.get(run_id, ()):
            queue.put_nowait((kind, payload))

    async def emit(self, step: StepEvent) -> StepEvent:
        async with self.lock:
            with self.db.session() as session:
                seq = session.exec(select(func.max(Step.seq)).where(Step.run_id == step.run_id)).one() or 0
                step = step.model_copy(update={"seq": seq + 1})
                payload = step.model_dump(mode="json")
                session.add(Step(run_id=step.run_id, seq=step.seq, payload=payload))
                session.commit()
            self.publish(step.run_id, "step", payload)
        return step

    async def status(self, run_id: str, status: RunStatus, *, expected: str | None = None):
        async with self.lock:
            with self.db.session() as session:
                run = session.get(Run, run_id)
                if run is None:
                    raise HTTPException(404, "Совещание не найдено.")
                if expected and run.status != expected:
                    raise HTTPException(409, "Совещание сейчас не ожидает подтверждения.")
                run.status = status
                session.add(run)
                session.commit()
            self.publish(run_id, "status", {"status": status})

    def steps(self, run_id: str, after: int = 0) -> list[dict]:
        with self.db.session() as session:
            return [s.payload for s in session.exec(
                select(Step).where(Step.run_id == run_id, Step.seq > after).order_by(Step.seq)
            ).all()]

    async def stream(self, run_id: str, after: int = 0):
        queue = asyncio.Queue()
        try:
            # Subscribe and snapshot without yielding: no event can fall in between.
            async with self.lock:
                self.subscribers[run_id].add(queue)
                history = self.steps(run_id, after)
                with self.db.session() as session:
                    status = session.get(Run, run_id).status
            for step in history:
                after = step["seq"]
                yield frame("step", step, after)
            yield frame("status", {"status": status})
            if status in TERMINAL:
                return
            while True:
                try:
                    kind, payload = await asyncio.wait_for(queue.get(), HEARTBEAT_SECONDS)
                except asyncio.TimeoutError:
                    yield ": ping\n\n"
                    continue
                if kind == "step":
                    if payload["seq"] <= after:
                        continue
                    after = payload["seq"]
                    yield frame(kind, payload, after)
                else:
                    yield frame(kind, payload)
                    if payload["status"] in TERMINAL:
                        return
        finally:
            self.subscribers[run_id].discard(queue)
            if not self.subscribers[run_id]:
                del self.subscribers[run_id]
