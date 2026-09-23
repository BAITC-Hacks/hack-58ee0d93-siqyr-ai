from __future__ import annotations

import asyncio
import base64
import re
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlparse

from .config import Config
from .lifecycle import Lifecycle
from .selectors import CAMERA, CAPTIONS, CHAT, DENIED, JOIN, LEAVE, MICROPHONE, first_button
from .sinks import FileSink, SessionSink

NOTICE = "Siqyr AI ведёт запись и расшифровку для протокола"


def validate_meet_url(url: str) -> str:
    parsed = urlparse(url)
    if parsed.scheme != "https" or parsed.hostname != "meet.google.com" or not re.fullmatch(r"/[a-z]{3}-[a-z]{4}-[a-z]{3}/?", parsed.path):
        raise ValueError("Ожидается ссылка вида https://meet.google.com/abc-defg-hij")
    return url


@dataclass
class BotJob:
    meet_url: str
    session_id: str
    title: str
    bot_id: str = field(default_factory=lambda: uuid.uuid4().hex)
    status: str = "starting"
    reason: str | None = None
    chunks: int = 0
    speaker_events: int = 0
    stop: asyncio.Event = field(default_factory=asyncio.Event, repr=False)

    def public(self) -> dict:
        return {"bot_id": self.bot_id, "session_id": self.session_id, "status": self.status,
                "reason": self.reason, "chunks": self.chunks, "speaker_events": self.speaker_events}


class MeetBot:
    def __init__(self, config: Config, sink: SessionSink | None = None):
        self.config = config
        self.config.validate()
        self.sink = sink or FileSink(config.output_dir)

    async def login(self) -> None:
        from playwright.async_api import async_playwright

        self.config.profile_dir.mkdir(parents=True, exist_ok=True)
        async with async_playwright() as playwright:
            context = await playwright.chromium.launch_persistent_context(
                str(self.config.profile_dir), headless=False, locale="en-US")
            try:
                page = await context.new_page()
                await page.goto("https://accounts.google.com/", wait_until="domcontentloaded")
                print("Войдите вручную в аккаунт бота. Когда закончите, нажмите Enter здесь.")
                await asyncio.to_thread(input)
            finally:
                await context.close()

    async def _debug(self, page, job: BotJob) -> None:
        directory = self.config.output_dir / job.session_id / "debug"
        directory.mkdir(parents=True, exist_ok=True)
        await page.screenshot(path=str(directory / "page.png"), full_page=True)
        (directory / "page.html").write_text(await page.content(), encoding="utf-8")

    async def run(self, job: BotJob) -> None:
        from playwright.async_api import async_playwright

        validate_meet_url(job.meet_url)
        queue: asyncio.Queue[dict] = asyncio.Queue()
        context = None
        page = None
        reason = "error"
        lifecycle = Lifecycle(started_ms=int(time.time() * 1000))
        try:
            async with async_playwright() as playwright:
                context = await playwright.chromium.launch_persistent_context(
                    str(self.config.profile_dir), headless=False, locale="en-US",
                    args=["--autoplay-policy=no-user-gesture-required", "--use-fake-ui-for-media-stream"])
                await context.expose_binding("__siqyrReceive", lambda _source, payload: queue.put_nowait(payload))
                capture = Path(__file__).with_name("capture.js").read_text(encoding="utf-8")
                capture = capture.replace("window.__SIQYR_CHUNK_MS || 10000", str(self.config.chunk_seconds * 1000))
                await context.add_init_script(script=capture)
                page = context.pages[0] if context.pages else await context.new_page()
                await page.goto(job.meet_url, wait_until="domcontentloaded", timeout=45000)
                await page.wait_for_timeout(2000)
                for labels in (MICROPHONE, CAMERA):
                    button = await first_button(page, labels)
                    if button:
                        await button.click()
                join = await first_button(page, JOIN)
                if not join:
                    raise RuntimeError("Кнопка входа в Meet не найдена; проверьте аккаунт и ссылку")
                await join.click()
                job.status = "waiting_admission"
                deadline = time.monotonic() + self.config.admission_timeout_s
                while time.monotonic() < deadline:
                    if job.stop.is_set():
                        job.status = "done"
                        job.reason = "Оператор отменил вход до допуска"
                        reason = "requested"
                        return
                    if any(await page.get_by_text(label, exact=False).count() for label in DENIED):
                        job.status = "denied"
                        job.reason = "Организатор отклонил запрос на вход"
                        reason = "denied"
                        return
                    if await first_button(page, LEAVE):
                        job.status = "in_meeting"
                        break
                    await page.wait_for_timeout(1000)
                if job.status != "in_meeting":
                    raise RuntimeError("Время ожидания допуска в Meet истекло")
                await self._announce(page, job)
                captions = await first_button(page, CAPTIONS)
                if captions:
                    await captions.click()
                await page.evaluate(Path(__file__).with_name("timeline.js").read_text(encoding="utf-8"))
                participant_count = None
                previous_count = None
                while True:
                    while not queue.empty():
                        await self._handle(job, await queue.get())
                    if job.stop.is_set():
                        lifecycle.stop_requested = True
                    ended = await first_button(page, LEAVE) is None
                    reason = lifecycle.reason(int(time.time() * 1000), participant_count, ended,
                                              self.config.alone_timeout_s, self.config.max_duration_s)
                    if reason:
                        break
                    # Meet's participant count is not reliably exposed in all layouts.
                    # Unknown is safer than treating a hidden panel as "alone".
                    participant_count = await self._participant_count(page)
                    if participant_count is not None and previous_count is not None and participant_count != previous_count:
                        event_type = "participant_join" if participant_count > previous_count else "participant_leave"
                        await self.sink.event(job.session_id, {"type": event_type, "name": None,
                                                               "participant_count": participant_count,
                                                               "t_ms": int(time.time() * 1000)})
                    if participant_count is not None:
                        previous_count = participant_count
                    await page.wait_for_timeout(1000)
                job.status = "leaving"
                await page.evaluate("window.__siqyrCapture && window.__siqyrCapture.stop()")
                await page.wait_for_timeout(1200)
                while not queue.empty():
                    await self._handle(job, await queue.get())
                leave = await first_button(page, LEAVE)
                if leave:
                    await leave.click()
                if job.chunks:
                    job.status = "done"
                    job.reason = reason
                else:
                    job.status = "error"
                    job.reason = "Не получены удалённые аудиотреки; запись пуста"
        except Exception as exc:
            job.status = "error"
            job.reason = str(exc)
            if page:
                try:
                    await self._debug(page, job)
                except Exception:
                    pass
        finally:
            if context:
                try:
                    await context.close()
                except Exception:
                    pass
            try:
                await self.sink.finish(job.session_id, reason)
            except Exception as exc:
                job.status = "error"
                job.reason = f"Не удалось завершить локальную сессию: {exc}"

    async def _handle(self, job: BotJob, payload: dict) -> None:
        kind = payload.get("type")
        if kind == "chunk":
            data = base64.b64decode(payload["base64"], validate=True)
            await self.sink.chunk(job.session_id, payload["segment"], payload["seq"], payload["started_at_ms"], data)
            job.chunks += 1
        elif kind == "speaker":
            job.speaker_events += 1
            await self.sink.event(job.session_id, payload)
        elif kind in {"segment", "audio_track", "error"}:
            await self.sink.event(job.session_id, payload)

    async def _announce(self, page, job: BotJob) -> None:
        chat = await first_button(page, CHAT)
        if not chat:
            raise RuntimeError("Чат Meet не найден: уведомление о записи не отправлено")
        await chat.click()
        field = page.get_by_role("textbox").last
        await field.fill(NOTICE)
        await field.press("Enter")
        await self.sink.event(job.session_id, {"type": "recording_notice", "t_ms": int(time.time() * 1000), "text": NOTICE})

    async def _participant_count(self, page) -> int | None:
        # Known accessible names include "People (2)". Return None if unavailable.
        buttons = page.get_by_role("button", name=re.compile(r"(?:People|Участники)\s*\(?(\d+)\)?", re.I))
        for i in range(await buttons.count()):
            label = await buttons.nth(i).get_attribute("aria-label") or ""
            match = re.search(r"(\d+)", label)
            if match:
                return int(match.group(1))
        return None
