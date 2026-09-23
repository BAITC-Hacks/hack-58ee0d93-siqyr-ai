"""Общие типы между backend/app (Meiirlan) и backend/agents (Alibi).

Меняются только по согласию обоих, с записью в docs/DECISIONS.md.
v0.2 (docs/CONTRACT.md) добавляет поля с умолчаниями: ответы v0.1 остаются валидными.
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
SourceMode = Literal["real", "mock", "replay"]
ReviewStatus = Literal["unreviewed", "confirmed", "corrected", "excluded"]
ReviewReason = Literal[
    "owner_uncertain", "deadline_conflict", "deadline_unknown", "location_uncertain", "scope_incomplete",
    "speaker_uncertain", "overlap", "evidence_missing", "audio_protocol_mismatch",
]


class Segment(BaseModel):
    """Одна реплика после STT + диаризации. text — сырой STT, не меняется после сохранения."""

    start: float  # секунды от начала записи
    end: float
    speaker: str | None  # SPEAKER_00, ...; None при overlap/сбое, а не выдуманный голос
    text: str
    lang: Lang | None = None
    speaker_candidates: list[str] = []
    corrected_text: str | None = None  # правка человека, отдельно от сырого text
    review_reasons: list[str] = []


class Participant(BaseModel):
    name: str
    role: str | None = None
    kind: Literal["person", "department"] = "person"
    present: bool = True  # исполнитель может не присутствовать и не говорить


class RunInput(BaseModel):
    """Вход propose(): транскрипт уже готов, агенты работают только с текстом."""

    run_id: str
    title: str
    meeting_date: date | None  # None — дата неизвестна: относительные сроки не нормализуются
    meeting_date_verified: bool = True
    lang: Lang = "rukk"
    participants: list[Participant] = []
    segments: list[Segment]


class Evidence(BaseModel):
    """Проверяемый источник поля поручения. start/end сервер берёт из сегмента."""

    segment_index: int = Field(ge=0)  # индекс в сыром транскрипте
    quote: str = Field(min_length=1)  # подстрока text этого сегмента
    start: float | None = None
    end: float | None = None
    field: Literal["task", "assignee", "deadline", "context"] = "context"
    kind: Literal["raw_transcript", "human_audio_correction"] = "raw_transcript"


class AssignmentDraft(BaseModel):
    assignee: str | None = None  # имя участника или отдел, не метка SPEAKER_xx; None — не указан
    task: str
    deadline: date | None = None
    deadline_text: str | None = None  # срок как его произнесли: «жұмаға дейін»
    priority: Priority = "normal"
    category: str | None = None
    source_segments: list[int] = []  # индексы в RunInput.segments
    deadline_candidates: list[str] = []  # несколько разных сроков = конфликт на проверку
    evidence: list[Evidence] = []
    review_status: ReviewStatus = "unreviewed"
    review_reasons: list[ReviewReason] = []
    review_note: str | None = None
    confidence: None = None  # калиброванной вероятности нет; показываем review_reasons


class Speaker(BaseModel):
    label: str  # SPEAKER_00
    participant_name: str | None = None
    mapping_status: Literal["unmapped", "suggested", "confirmed"] = "suggested"
    source_segments: list[int] = []


class Proposal(BaseModel):
    """Черновик протокола. Секретарь может отредактировать его перед approve."""

    run_id: str
    summary: str
    decisions: list[str] = []
    speakers: dict[str, str] = {}  # SPEAKER_00 -> имя участника
    segments: list[Segment] = []  # сырой транскрипт; правки только в corrected_text
    assignments: list[AssignmentDraft] = []
    revision: int = Field(default=1, ge=1)  # задаёт сервер; optimistic check при save/approve
    source_mode: SourceMode = "mock"  # задаёт сервер, раннер не может объявить mock реальным
    speaker_records: list[Speaker] = []


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
