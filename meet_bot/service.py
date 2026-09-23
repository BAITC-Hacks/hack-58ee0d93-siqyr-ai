from __future__ import annotations

import asyncio
import uuid

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from .bot import BotJob, MeetBot, validate_meet_url
from .config import Config


class StartRequest(BaseModel):
    meet_url: str
    session_id: str | None = None
    title: str | None = None


def make_app(config: Config | None = None) -> FastAPI:
    config = config or Config()
    config.validate()
    app = FastAPI(title="Siqyr Meet demo bot")
    bot = MeetBot(config)
    jobs: dict[str, BotJob] = {}
    tasks: dict[str, asyncio.Task] = {}

    @app.post("/bots", status_code=201)
    async def start(body: StartRequest):
        try:
            validate_meet_url(body.meet_url)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from None
        active = sum(not task.done() for task in tasks.values())
        # One persistent Google profile cannot be opened by two Chromium processes.
        if active >= min(config.max_bots, 1):
            raise HTTPException(429, "Профиль бота уже используется")
        session_id = body.session_id or uuid.uuid4().hex
        try:
            bot.sink.session_dir(session_id)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from None
        job = BotJob(meet_url=body.meet_url, session_id=session_id, title=body.title or "Google Meet")
        jobs[job.bot_id] = job
        tasks[job.bot_id] = asyncio.create_task(bot.run(job))
        return {"bot_id": job.bot_id, "session_id": session_id}

    @app.get("/bots/{bot_id}")
    async def status(bot_id: str):
        if bot_id not in jobs:
            raise HTTPException(404, "Бот не найден")
        return jobs[bot_id].public()

    @app.delete("/bots/{bot_id}")
    async def stop(bot_id: str):
        if bot_id not in jobs:
            raise HTTPException(404, "Бот не найден")
        jobs[bot_id].stop.set()
        return jobs[bot_id].public()

    return app


app = make_app()
