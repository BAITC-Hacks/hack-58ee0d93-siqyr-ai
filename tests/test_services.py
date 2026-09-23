import asyncio
import json
from dataclasses import replace
from datetime import date, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock

from sqlmodel import select

from backend.app import config
from backend.app.llm import LLM
from backend.app.models import Assignment, Notification, Run, Step
from backend.app.reminders import check_reminders
from backend.shared.schemas import StepEvent
from test_api import create, finish, wait_for


def test_replay_latest_and_explicit(client_factory, monkeypatch):
    client = client_factory()
    original_id = create(client)
    original = finish(client, original_id)
    runtime = client.app.state.runtime
    runtime.settings = replace(runtime.settings, demo_mode="replay")
    from backend import stt
    monkeypatch.setattr(stt, "transcribe", lambda *args: (_ for _ in ()).throw(AssertionError("Replay must not call STT")))
    for source in ("", original_id):
        runtime.settings = replace(runtime.settings, replay_run_id=source)
        run_id = create(client)
        pending = wait_for(client, run_id, "awaiting_approval")
        assert pending["proposal"]["run_id"] == run_id
        assert pending["proposal"]["assignments"] == original["proposal"]["assignments"]
        assert pending["steps"][-1]["type"] == "needs_approval"
        assert sum(step["type"] == "needs_approval" for step in pending["steps"]) == 1
        assert all(step["run_id"] == run_id for step in pending["steps"])
        assert "final" not in [step["type"] for step in pending["steps"]]
        finish(client, run_id)


def test_replay_no_source(client_factory):
    client = client_factory(demo_mode="replay")
    run_id = create(client)
    detail = wait_for(client, run_id, "error")
    assert "Нет завершённого" in detail["steps"][-1]["content"]


def test_replay_caps_timing(client, monkeypatch):
    run_id = create(client)
    finish(client, run_id)
    runtime = client.app.state.runtime
    with runtime.db.session() as session:
        steps = session.exec(select(Step).where(Step.run_id == run_id).order_by(Step.seq)).all()
        from datetime import datetime, timezone
        start = datetime(2026, 1, 1, tzinfo=timezone.utc)
        for index, step in enumerate(steps):
            step.payload = {**step.payload, "ts": (start + timedelta(seconds=index * 30)).isoformat()}
            session.add(step)
        target = Run(title="Replay", meeting_date=date(2026, 9, 23))
        session.add(target)
        session.commit()
    runtime.settings = replace(runtime.settings, replay_run_id=run_id)
    delays = []
    async def sleep(delay):
        delays.append(delay)
    monkeypatch.setattr("backend.app.pipeline.asyncio.sleep", sleep)
    asyncio.run(runtime.replay(target))
    assert delays and all(delay == 2 for delay in delays)


def test_llm_cache_and_metering(client, monkeypatch, caplog):
    from backend.app import llm
    calls = []
    reply = SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content="Результат"))],
                            usage=SimpleNamespace(prompt_tokens=10, completion_tokens=5, total_tokens=15))
    fake = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=AsyncMock(return_value=reply))), close=AsyncMock())
    def constructor(**kwargs):
        calls.append(kwargs)
        return fake
    monkeypatch.setattr(llm, "AsyncOpenAI", constructor)
    settings = replace(client.settings, llm_base_url="http://local.invalid/v1", llm_api_key="", price_in_per_1m=2, price_out_per_1m=4)
    service = LLM(client.app.state.runtime.db, settings)
    async def exercise():
        first = await service.complete([{"role": "user", "content": "Синтетический пример"}])
        cached = await service.complete([{"role": "user", "content": "Синтетический пример"}])
        assert first.content == cached.content == "Результат"
        assert first.tokens == 15 and first.cost_usd == 0.00004
        assert cached.cached and cached.tokens == 0 and cached.cost_usd == 0
        assert fake.chat.completions.create.await_count == 1
        assert "temperature" not in fake.chat.completions.create.call_args.kwargs
        await service.complete([{"role": "user", "content": "Синтетический пример"}], temperature=0.5)
        assert fake.chat.completions.create.await_count == 2
        await service.close()
    with caplog.at_level("INFO"):
        asyncio.run(exercise())
    assert len(calls) == 1 and calls[0]["base_url"] == settings.llm_base_url
    assert "tokens=15" in caplog.text
    # A fresh wrapper reads the persisted cache without creating a client.
    second = LLM(client.app.state.runtime.db, settings)
    assert asyncio.run(second.complete([{"role": "user", "content": "Синтетический пример"}])).cached
    assert len(calls) == 1


def test_reminders_next_day_and_window(client_factory):
    client = client_factory(seed=True, remind_days_before=2)
    db = client.app.state.runtime.db
    with db.session() as session:
        run = session.exec(select(Run)).first()
        for days in (1, 2, 3):
            session.add(Assignment(run_id=run.id, assignee="Демо", task=f"Через {days} дней", deadline=date(2026, 9, 23) + timedelta(days=days)))
        session.add(Assignment(run_id=run.id, assignee="Демо", task="Без срока"))
        session.commit()
    assert check_reminders(db, client.settings)["created"] == 4
    assert check_reminders(db, client.settings)["created"] == 0
    next_day = replace(client.settings, demo_today="2026-09-24")
    assert check_reminders(db, next_day)["created"] == 5
    with db.session() as session:
        notifications = session.exec(select(Notification)).all()
        assert len(notifications) == 9


def test_sse_heartbeat_and_cleanup(client, monkeypatch):
    from backend.app import events
    monkeypatch.setattr(events, "HEARTBEAT_SECONDS", 0.01)
    runtime = client.app.state.runtime
    with runtime.db.session() as session:
        run = Run(title="Heartbeat", meeting_date=date(2026, 9, 23), status="awaiting_approval")
        session.add(run)
        session.commit()
    async def exercise():
        stream = runtime.events.stream(run.id)
        assert '"status": "awaiting_approval"' in await anext(stream)
        assert await anext(stream) == ": ping\n\n"
        event = await runtime.events.emit(StepEvent(run_id=run.id, type="final", agent="secretary", content="Готово"))
        await runtime.events.status(run.id, "done")
        assert f"id: {event.seq}" in await anext(stream)
        assert '"status": "done"' in await anext(stream)
        try:
            await anext(stream)
        except StopAsyncIteration:
            pass
        else:
            raise AssertionError("Terminal stream did not close")
        assert run.id not in runtime.events.subscribers
        disconnected = runtime.events.stream(run.id)
        await anext(disconnected)
        await disconnected.aclose()
        assert run.id not in runtime.events.subscribers
    asyncio.run(exercise())


def test_real_stt_dispatch(client, monkeypatch):
    import sys
    from pathlib import Path
    from backend import stt
    from backend.shared.schemas import Segment
    segment = Segment(start=0, end=1, speaker="SPEAKER_00", text="тест")
    engine = SimpleNamespace(transcribe=lambda path, lang: [segment])
    monkeypatch.setitem(sys.modules, "backend.stt.engine", engine)
    monkeypatch.setattr(config, "settings", replace(client.settings, stt_mode="real"))
    assert stt.transcribe(Path("test.wav"), "ru") == [segment]


def test_restart_marks_interrupted_run(client_factory):
    first = client_factory()
    with first.app.state.runtime.db.session() as session:
        interrupted = Run(title="Прерванный запуск", meeting_date=date(2026, 9, 23), status="executing")
        pending = Run(title="Ожидает проверки", meeting_date=date(2026, 9, 23), status="awaiting_approval")
        session.add(interrupted)
        session.add(pending)
        session.commit()
    second = client_factory()
    assert second.get(f"/api/runs/{interrupted.id}").json()["run"]["status"] == "error"
    assert second.get(f"/api/runs/{pending.id}").json()["run"]["status"] == "awaiting_approval"
