from __future__ import annotations

import json
from pathlib import Path
from typing import Protocol

try:
    import httpx
except ModuleNotFoundError:
    httpx = None


class SessionSink(Protocol):
    async def chunk(self, session_id: str, segment: int, seq: int, started_at_ms: int, data: bytes) -> None: ...
    async def event(self, session_id: str, event: dict) -> None: ...
    async def finish(self, session_id: str, reason: str) -> dict: ...


class FileSink:
    def __init__(self, output_dir: Path):
        self.output_dir = output_dir

    def session_dir(self, session_id: str) -> Path:
        if not session_id or any(c not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_" for c in session_id):
            raise ValueError("Недопустимый session_id")
        return self.output_dir / session_id

    async def chunk(self, session_id: str, segment: int, seq: int, started_at_ms: int, data: bytes) -> None:
        if segment < 0 or seq < 0 or not data:
            raise ValueError("Некорректный сегмент, seq или пустой чанк")
        target = self.session_dir(session_id) / f"segment-{segment}" / f"chunk-{seq:06d}.webm"
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists():
            if target.read_bytes() != data:
                raise ValueError("Повтор seq содержит другие данные")
            return
        target.write_bytes(data)
        manifest = target.parent / "started_at_ms.txt"
        if not manifest.exists():
            manifest.write_text(str(started_at_ms), encoding="utf-8")

    async def event(self, session_id: str, event: dict) -> None:
        directory = self.session_dir(session_id)
        directory.mkdir(parents=True, exist_ok=True)
        with (directory / "timeline.jsonl").open("a", encoding="utf-8") as output:
            output.write(json.dumps(event, ensure_ascii=False) + "\n")

    async def finish(self, session_id: str, reason: str) -> dict:
        directory = self.session_dir(session_id)
        directory.mkdir(parents=True, exist_ok=True)
        (directory / "finish.json").write_text(json.dumps({"reason": reason}, ensure_ascii=False), encoding="utf-8")
        return {"session_id": session_id, "output_dir": str(directory)}


class HttpSink:
    """Future session API with a disk queue. A failed upload is never discarded."""

    def __init__(self, base_url: str, token: str, output_dir: Path, client: httpx.AsyncClient | None = None):
        if httpx is None:
            raise RuntimeError("Установите зависимости из meet_bot/requirements.txt")
        self.base_url = base_url.rstrip("/")
        self.headers = {"Authorization": f"Bearer {token}"} if token else {}
        self.spool = FileSink(output_dir)
        self.client = client or httpx.AsyncClient(timeout=30)
        self.owns_client = client is None

    async def close(self) -> None:
        if self.owns_client:
            await self.client.aclose()

    async def create(self, meet_url: str, title: str) -> str:
        response = await self.client.post(f"{self.base_url}/api/sessions", headers=self.headers,
                                          json={"source": "meet_bot", "meet_url": meet_url, "title": title,
                                                "lang": "rukk", "department_id": "default"})
        response.raise_for_status()
        return response.json()["session_id"]

    async def chunk(self, session_id: str, segment: int, seq: int, started_at_ms: int, data: bytes) -> None:
        await self.spool.chunk(session_id, segment, seq, started_at_ms, data)
        await self.flush(session_id)

    async def flush(self, session_id: str) -> bool:
        directory = self.spool.session_dir(session_id)
        paths = sorted(directory.glob("segment-*/chunk-*.webm"),
                       key=lambda path: (int(path.parent.name.split("-")[1]), int(path.stem.split("-")[1])))
        for path in paths:
            segment = int(path.parent.name.split("-")[1])
            seq = int(path.stem.split("-")[1])
            started_at_ms = int((path.parent / "started_at_ms.txt").read_text(encoding="utf-8"))
            try:
                response = await self.client.post(
                    f"{self.base_url}/api/sessions/{session_id}/chunks", headers=self.headers,
                    data={"segment": str(segment), "seq": str(seq), "started_at_ms": str(started_at_ms)},
                    files={"file": (path.name, path.read_bytes(), "audio/webm")},
                )
                response.raise_for_status()
            except (httpx.HTTPError, OSError):
                return False
            path.unlink()
        return True

    async def event(self, session_id: str, event: dict) -> None:
        await self.spool.event(session_id, event)

    async def finish(self, session_id: str, reason: str) -> dict:
        await self.spool.finish(session_id, reason)
        if not await self.flush(session_id):
            return {"session_id": session_id, "pending": True}
        directory = self.spool.session_dir(session_id)
        timeline = directory / "timeline.jsonl"
        events = [json.loads(line) for line in timeline.read_text(encoding="utf-8").splitlines()] if timeline.exists() else []
        try:
            if events:
                response = await self.client.post(f"{self.base_url}/api/sessions/{session_id}/timeline",
                                                  headers=self.headers, json={"events": events})
                response.raise_for_status()
            response = await self.client.post(f"{self.base_url}/api/sessions/{session_id}/finish",
                                              headers=self.headers, json={"reason": reason})
            response.raise_for_status()
        except httpx.HTTPError:
            return {"session_id": session_id, "pending": True}
        if timeline.exists():
            timeline.unlink()
        (directory / "finish.json").unlink(missing_ok=True)
        return response.json()
