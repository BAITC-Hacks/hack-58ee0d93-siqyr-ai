"""Siqyr AI API. Маршруты — строго по docs/CONTRACT.md (M1/M2 дописывают остальное)."""
from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings, today

app = FastAPI(title="Siqyr AI", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_origin_regex=settings.cors_origin_regex or None,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health() -> dict:
    return {
        "status": "ok",
        "agent_mode": settings.agent_mode,
        "stt_mode": settings.stt_mode,
        "demo_mode": settings.demo_mode,
        "llm": "local" if settings.llm_base_url else "openai",
        "today": today().isoformat(),
    }
