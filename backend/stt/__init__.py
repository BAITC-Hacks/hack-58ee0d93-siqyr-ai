"""Граница STT + диаризации. Всё, что выше (агенты, API), видит только list[Segment].

Контракт (docs/CONTRACT.md):
    transcribe(audio_path: Path, lang: str) -> list[Segment]

STT_MODE=mock  -> демо-транскрипт из data/seed/demo_meeting.json
STT_MODE=real  -> backend/stt/engine.py (Alibi: модель alibiserikbay/kazakh-russian-mixed-stt)
"""

from pathlib import Path

from backend.app import config
from backend.app.demo import demo_meeting
from backend.shared.schemas import Segment


def transcribe(audio_path: Path, lang: str = "rukk") -> list[Segment]:
    if lang not in {"rukk", "kk", "ru"}:
        raise ValueError("Язык должен быть ru, kk или rukk.")
    if config.settings.stt_mode == "mock":
        return [Segment.model_validate(segment) for segment in demo_meeting()["segments"]]
    if config.settings.stt_mode == "real":
        from .engine import transcribe as real_transcribe
        return real_transcribe(audio_path, lang)
    raise ValueError("Неизвестный режим STT_MODE.")
