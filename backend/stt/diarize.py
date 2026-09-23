"""Offline pyannote Community-1 speaker diarization.

This stage identifies acoustic voices only. VAD and participant names are separate.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

import numpy as np


class DiarizationUnavailable(RuntimeError):
    """Local gated model or its runtime is not available."""


@dataclass(frozen=True)
class VoiceTurn:
    start: float
    end: float
    speaker: str


def diarize(samples: np.ndarray, model_dir: Path | None = None) -> list[VoiceTurn]:
    """Run Community-1 on in-memory 16 kHz mono audio, entirely offline."""
    default_dir = Path(__file__).resolve().parents[2] / "models/diarization"
    folder = Path(model_dir or os.environ.get("DIARIZATION_MODEL_DIR", default_dir))
    if not (folder / "config.yaml").is_file():
        raise DiarizationUnavailable(f"Community-1 local bundle missing: {folder}")

    # Set before importing pyannote or Hugging Face dependencies. Local path only.
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
    os.environ["PYANNOTE_METRICS_ENABLED"] = "0"
    try:
        import torch
        from pyannote.audio import Pipeline
    except ImportError as exc:
        raise DiarizationUnavailable("pyannote.audio and torch are required for local diarization") from exc

    try:
        pipeline = Pipeline.from_pretrained(str(folder.resolve()))
        pipeline.to(torch.device("cpu"))
        waveform = torch.from_numpy(samples).unsqueeze(0)
        output = pipeline({"waveform": waveform, "sample_rate": 16_000})
    except Exception as exc:
        # Do not print tokens, audio paths, or model internals in application logs.
        raise DiarizationUnavailable("Local Community-1 bundle could not be loaded or run") from exc

    annotation = output.speaker_diarization
    turns = [
        VoiceTurn(max(0.0, float(turn.start)), float(turn.end), str(label))
        for turn, _, label in annotation.itertracks(yield_label=True)
        if turn.end > turn.start
    ]
    return sorted(turns, key=lambda turn: (turn.start, turn.end, turn.speaker))


def speech_spans(turns: list[VoiceTurn], duration: float) -> list[VoiceTurn]:
    """Partition turns at speaker changes; an overlap stays explicitly unresolved."""
    points = {0.0, duration}
    for turn in turns:
        points.add(min(duration, max(0.0, turn.start)))
        points.add(min(duration, max(0.0, turn.end)))
    edges = sorted(points)
    spans: list[VoiceTurn] = []
    for start, end in zip(edges, edges[1:]):
        if end <= start:
            continue
        middle = (start + end) / 2
        active = {turn.speaker for turn in turns if turn.start <= middle < turn.end}
        if not active:
            continue
        speaker = next(iter(active)) if len(active) == 1 else "OVERLAP"
        if spans and spans[-1].speaker == speaker and start - spans[-1].end <= 0.3:
            spans[-1] = VoiceTurn(spans[-1].start, end, speaker)
        else:
            spans.append(VoiceTurn(start, end, speaker))
    return spans
