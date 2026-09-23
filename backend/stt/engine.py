"""Local mixed Kazakh/Russian TorchScript CTC recognizer."""

from __future__ import annotations

import logging
import os
import re
from pathlib import Path

import numpy as np

from backend.shared.schemas import Segment

from .audio import SAMPLE_RATE, decode_audio, split_interval
from .diarize import DiarizationUnavailable, VoiceTurn, diarize, speech_spans

LOGGER = logging.getLogger(__name__)
ADM = Path.home() / "Downloads/ADM/ansible/install/roles"
ADM_MODEL = ADM / "triton/tasks/files/asr/rukk/16000/v1.0.1_ep03/3/model.pt"
ADM_TOKENS = ADM / "speech-service/tasks/files/lm/rukk_2025_09_02/2025-09-02/tokens.lst"
REPO_MODEL = Path(__file__).resolve().parents[2] / "models/stt/asr/rukk"


def _artifacts() -> tuple[Path, Path]:
    configured = os.environ.get("STT_MODEL_DIR")
    if configured:
        folder = Path(configured)
        pair = folder / "asr/rukk"
        model, tokens = pair / "model.pt", pair / "tokens.lst"
    else:
        local_model, local_tokens = REPO_MODEL / "model.pt", REPO_MODEL / "tokens.lst"
        model, tokens = (local_model, local_tokens) if local_model.is_file() and local_tokens.is_file() else (ADM_MODEL, ADM_TOKENS)
    missing = [path for path in (model, tokens) if not path.is_file()]
    if missing:
        raise FileNotFoundError("Local mixed STT model.pt and matching tokens.lst are required: " + ", ".join(map(str, missing)))
    return model, tokens


def _load_model() -> tuple[object, dict[int, str]]:
    try:
        import torch
    except ImportError as exc:
        raise RuntimeError("PyTorch is required for local mixed STT") from exc
    model_path, tokens_path = _artifacts()
    tokens: dict[int, str] = {}
    for line in tokens_path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            symbol, number = line.split("\t")
            tokens[int(number)] = symbol
    if not tokens or sorted(tokens) != list(range(max(tokens) + 1)):
        raise ValueError("STT tokens.lst is empty or has non-contiguous indices")
    model = torch.jit.load(str(model_path), map_location="cpu").eval()
    return model, tokens


def _decode(model: object, tokens: dict[int, str], samples: np.ndarray) -> str:
    import torch

    with torch.inference_mode():
        logits = model(torch.from_numpy(np.ascontiguousarray(samples)).unsqueeze(0))[0]
    ids = logits[0].argmax(-1).tolist()
    blank = max(tokens) + 1
    output: list[str] = []
    previous: int | None = None
    for index in ids:
        if index != previous and index != blank:
            output.append(tokens.get(index, ""))
        previous = index
    return re.sub(r"\s+", " ", "".join(output).replace("|", " ").replace("_", " ")).strip().lower()


def transcribe(audio_path: Path, lang: str = "rukk") -> list[Segment]:
    """Return ordered, source-timed segments with real or explicitly unknown voices."""
    if lang not in {"rukk", "kk", "ru"}:
        raise ValueError("lang must be rukk, kk, or ru")
    samples = decode_audio(Path(audio_path))
    duration = len(samples) / SAMPLE_RATE
    try:
        turns = speech_spans(diarize(samples), duration)
    except DiarizationUnavailable as exc:
        LOGGER.warning("Diarization unavailable; all speakers require review: %s", exc)
        turns = [VoiceTurn(0.0, duration, "UNKNOWN")]
    model, tokens = _load_model()
    segments: list[Segment] = []
    for turn in turns:
        for start, end in split_interval(samples, turn.start, turn.end):
            clip = samples[round(start * SAMPLE_RATE):round(end * SAMPLE_RATE)]
            if len(clip) < 320:
                continue
            text = _decode(model, tokens, clip)
            if text:
                segments.append(Segment(start=start, end=end, speaker=turn.speaker, text=text, lang=lang))
    return segments
