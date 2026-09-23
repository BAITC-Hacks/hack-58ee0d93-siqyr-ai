"""Pitch bridge from local Meet capture to the existing /api/runs upload API."""
from __future__ import annotations

import asyncio
import shutil
import subprocess
import tempfile
from pathlib import Path

import httpx

from .config import Config
from .sinks import FileSink


def assemble(directory: Path, target: Path) -> None:
    segments = sorted(directory.glob("segment-*"), key=lambda p: int(p.name.split("-")[1]))
    if not segments:
        raise ValueError("Нет сегментов аудио")
    with tempfile.TemporaryDirectory() as temp:
        merged: list[Path] = []
        for segment in segments:
            chunks = sorted(segment.glob("chunk-*.webm"))
            if not chunks:
                continue
            path = Path(temp) / f"{segment.name}.webm"
            with path.open("wb") as output:
                for chunk in chunks:
                    output.write(chunk.read_bytes())
            merged.append(path)
        if not merged:
            raise ValueError("Все сегменты пусты")
        if len(merged) == 1:
            shutil.copyfile(merged[0], target)
            return
        if not shutil.which("ffmpeg"):
            raise RuntimeError("Для нескольких сегментов нужен ffmpeg в PATH")
        listing = Path(temp) / "concat.txt"
        listing.write_text("".join(f"file '{path.as_posix()}'\n" for path in merged), encoding="utf-8")
        subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0",
                        "-i", str(listing), "-c", "copy", "-y", str(target)], check=True)


async def import_run(session_id: str, title: str, config: Config) -> dict:
    directory = FileSink(config.output_dir).session_dir(session_id)
    if not directory.is_dir():
        raise ValueError("Локальная сессия не найдена")
    with tempfile.TemporaryDirectory() as temp:
        audio = Path(temp) / "meeting.webm"
        assemble(directory, audio)
        headers = {"Authorization": f"Bearer {config.api_token}"} if config.api_token else {}
        async with httpx.AsyncClient(base_url=config.api_base_url, headers=headers, timeout=120) as client:
            with audio.open("rb") as source:
                response = await client.post("/api/runs", data={"title": title, "lang": "rukk",
                                                                 "department_id": "default"},
                                             files={"file": ("meet-recording.webm", source, "audio/webm")})
            response.raise_for_status()
            return {"run_id": response.json()["run_id"], "status": response.json()["status"],
                    "audio_bytes": audio.stat().st_size}
