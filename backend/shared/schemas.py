"""Общие типы между backend/app (Meiirlan) и backend/agents (Alibi).

Меняются только по согласию обоих, с записью в docs/DECISIONS.md.
"""
from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Any, Awaitable, Callable, Literal

from pydantic import BaseModel, Field

Lang = Literal["rukk", "kk", "ru"]
RunStatus = Literal[
    "queued", "transcribing", "running", "awaiting_approval", "executing", "done", "rejected", "error"
]
EventType = Literal["agent_start", "tool_call", "tool_result", "handoff", "needs_approval", "final", "error"]
Priority = Literal["high", "normal", "low"]
AssignmentStatus = Literal["in_progress", "overdue", "done"]


class Segment(BaseModel):
    """Одна реплика после STT + диаризации."""

    start: float  # секунды от начала записи
    end: float
    speaker: str  # метка диаризации: SPEAKER_00, SPEAKER_01, ...
    text: str
    lang: Lang | None = None


class Participant(BaseModel):
    name: str
    role: str | None = None


class RunInput(BaseModel):
    """Вход propose(): транскрипт уже готов, агенты работают только с текстом."""

    run_id: str
    title: str
    meeting_date: date
    lang: Lang = "rukk"
    participants: list[Participant] = []
    segments: list[Segment]


class AssignmentDraft(BaseModel):
    assignee: str  # имя участника, не метка SPEAKER_xx
    task: str
    deadline: date | None = None
    deadline_text: str | None = None  # срок как его произнесли: «жұмаға дейін»
    priority: Priority = "normal"
    category: str | None = None
    source_segments: list[int] = []  # индексы в RunInput.segments


class Proposal(BaseModel):
    """Черновик протокола. Секретарь может отредактировать его перед approve."""

    run_id: str
    summary: str
    decisions: list[str] = []
    speakers: dict[str, str] = {}  # SPEAKER_00 -> имя участника
    segments: list[Segment] = []  # очищенный транскрипт; пусто = исходный
    assignments: list[AssignmentDraft] = []


class Excerpt(BaseModel):
    """Выдержка из протокола для одного ответственного."""

    recipient: str
    message: str


class Result(BaseModel):
    run_id: str
    excerpts: list[Excerpt] = []


class StepEvent(BaseModel):
    run_id: str
    seq: int = 0  # проставляет бэкенд в emit()
    type: EventType
    agent: str
    content: str  # одна строка для карточки в трейсе
    data: dict[str, Any] = {}
    tokens: int = 0
    cost_usd: float = 0.0
    ts: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


Emit = Callable[[StepEvent], Awaitable[StepEvent]]
