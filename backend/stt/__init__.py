"""Граница STT + диаризации. Всё, что выше (агенты, API), видит только list[Segment].

Контракт (docs/CONTRACT.md):
    transcribe(audio_path: Path, lang: str) -> list[Segment]

STT_MODE=mock  -> демо-транскрипт из data/seed/demo_meeting.json
STT_MODE=real  -> backend/stt/engine.py (Alibi: модель alibiserikbay/kazakh-russian-mixed-stt)
"""
