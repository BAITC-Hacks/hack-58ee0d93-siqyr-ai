"""Decode meeting audio locally and split it without changing the time axis."""

from __future__ import annotations

import subprocess
from pathlib import Path

import numpy as np

SAMPLE_RATE = 16_000
MAX_CHUNK_SECONDS = 18.0


def decode_audio(path: Path) -> np.ndarray:
    """Return mono 16 kHz float32 PCM; ffmpeg never contacts a remote service."""
    path = Path(path)
    if not path.is_file():
        raise FileNotFoundError(f"Audio file not found: {path}")
    command = [
        "ffmpeg", "-nostdin", "-loglevel", "error", "-i", str(path),
        "-ac", "1", "-ar", str(SAMPLE_RATE), "-f", "f32le", "pipe:1",
    ]
    try:
        result = subprocess.run(command, capture_output=True, check=True)
    except FileNotFoundError as exc:
        raise RuntimeError("ffmpeg is required for local audio decoding") from exc
    except subprocess.CalledProcessError as exc:
        detail = exc.stderr.decode("utf-8", errors="replace").strip()
        raise ValueError(f"Could not decode audio: {detail}") from exc
    samples = np.frombuffer(result.stdout, dtype="<f4").copy()
    if not len(samples):
        raise ValueError("Audio contains no decodable samples")
    return samples


def split_interval(samples: np.ndarray, start: float, end: float) -> list[tuple[float, float]]:
    """Cut at quiet points near 15 s, keeping every chunk at most 18 s."""
    first = max(0, round(start * SAMPLE_RATE))
    last = min(len(samples), round(end * SAMPLE_RATE))
    if last <= first:
        return []
    frame_size = 160  # 10 ms
    view = samples[first:last]
    frames = len(view) // frame_size
    pauses: list[int] = []
    if frames:
        rms = np.sqrt(np.mean(view[: frames * frame_size].reshape(frames, frame_size) ** 2, axis=1))
        quiet = rms < 10 ** (-35 / 20)
        run_start: int | None = None
        for index, is_quiet in enumerate(quiet):
            if is_quiet and run_start is None:
                run_start = index
            elif not is_quiet and run_start is not None:
                if index - run_start >= 12:
                    pauses.append(first + (run_start + index) * frame_size // 2)
                run_start = None
    cuts = [first]
    target = 15 * SAMPLE_RATE
    maximum = int(MAX_CHUNK_SECONDS * SAMPLE_RATE)
    while last - cuts[-1] > maximum:
        current = cuts[-1]
        candidates = [p for p in pauses if current + 11 * SAMPLE_RATE <= p <= current + maximum]
        cut = min(candidates, key=lambda p: abs(p - current - target)) if candidates else current + target
        cuts.append(cut)
    cuts.append(last)
    return [(left / SAMPLE_RATE, right / SAMPLE_RATE) for left, right in zip(cuts, cuts[1:])]
