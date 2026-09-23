"""Offline readiness of the configured modes: shared by /api/health, POST /api/runs (503) and scripts/preflight.py.

Only local checks here; nothing is downloaded. The optional LLM probe talks to the configured endpoint only.
"""
import importlib.util
import json
import shutil
import sys
from dataclasses import asdict, dataclass
from urllib.parse import urlsplit

import httpx

from .config import Settings

LOOPBACK = {"127.0.0.1", "localhost", "::1"}


def llm_in_contour(settings: Settings) -> bool:
    """Local LLM of this deployment: loopback or a self-hosted host the admin listed in LLM_ALLOWED_HOSTS
    (the Ollama container of docker compose, a vLLM server inside the customer's network)."""
    host = urlsplit(settings.llm_base_url).hostname if settings.llm_base_url else None
    return settings.llm_provider == "local" and host is not None and host in LOOPBACK | set(settings.llm_allowed_hosts)


@dataclass(frozen=True)
class Check:
    name: str
    level: str  # ok | warn | fail
    detail: str


def _module(name: str) -> bool:
    return importlib.util.find_spec(name) is not None


def model_checks(settings: Settings) -> list[Check]:
    """Checks that block a real run: missing weights/tools produce 503, not a download attempt."""
    checks = []
    if settings.stt_mode == "real":
        stt_dir = settings.stt_model_dir
        missing = [p for p in ("asr/rukk", "vad/vad.onnx") if not (stt_dir / p).exists()]
        checks.append(Check("stt_weights", "fail" if missing else "ok",
                            f"нет {', '.join(missing)} в {stt_dir}; запустите scripts/setup.sh --download-models" if missing else str(stt_dir)))
        diar = settings.diarization_model_dir
        has_diar = diar.is_dir() and any(diar.iterdir())
        checks.append(Check("diarization_weights", "ok" if has_diar else "fail",
                            str(diar) if has_diar else f"нет весов pyannote в {diar}: примите условия модели на Hugging Face и запустите setup"))
        checks.append(Check("ffmpeg", "ok" if shutil.which("ffmpeg") else "fail",
                            shutil.which("ffmpeg") or "ffmpeg не найден в PATH (нужен для 16 кГц mono)"))
        absent = [m for m in ("torch", "onnxruntime", "soundfile") if not _module(m)]
        checks.append(Check("stt_packages", "fail" if absent else "ok",
                            "не установлены: " + ", ".join(absent) + " (setup.sh --with-stt)" if absent else "torch, onnxruntime, soundfile"))
    if settings.agent_mode == "real":
        url = settings.llm_base_url
        host = urlsplit(url).hostname if url else None
        if not url:
            checks.append(Check("llm_endpoint", "fail", "LLM_BASE_URL пуст: облачного fallback нет"))
        elif settings.llm_provider == "local" and host not in LOOPBACK | set(settings.llm_allowed_hosts):
            checks.append(Check("llm_endpoint", "fail", "LLM_PROVIDER=local требует loopback или хост из LLM_ALLOWED_HOSTS"))
        else:
            checks.append(Check("llm_endpoint", "ok" if host in LOOPBACK else "warn",
                                f"{settings.llm_provider} {url}" + ("" if host in LOOPBACK else " — не loopback: данные уходят на другой хост")))
    return checks


def probe_llm(settings: Settings, timeout: float = 3) -> Check:
    """Ask the configured OpenAI-compatible endpoint which models it serves (Ollama/vLLM: GET /models)."""
    try:
        response = httpx.get(settings.llm_base_url.rstrip("/") + "/models", timeout=timeout, trust_env=False,
                             headers={"Authorization": f"Bearer {settings.llm_api_key or 'local'}"})
        response.raise_for_status()
        served = {item.get("id") for item in response.json().get("data", [])}
    except (httpx.HTTPError, ValueError) as exc:
        return Check("llm_model", "fail", f"LLM недоступна по {settings.llm_base_url}: {type(exc).__name__}. Запустите ollama serve.")
    missing = [m for m in (settings.model_main, settings.model_fast) if m and m not in served]
    if settings.model_main in missing:
        return Check("llm_model", "fail", f"модель {settings.model_main} не загружена: ollama pull {settings.model_main}")
    return Check("llm_model", "warn" if missing else "ok",
                 f"{settings.model_main} доступна" + (f"; нет резервной {', '.join(missing)}" if missing else ""))


def environment_checks(settings: Settings) -> list[Check]:
    checks = [Check("python", "ok" if sys.version_info >= (3, 12) else "fail", sys.version.split()[0])]
    absent = [m for m in ("fastapi", "sqlmodel", "docx", "fpdf", "openai", "jwt") if not _module(m)]
    checks.append(Check("api_packages", "fail" if absent else "ok",
                        "не установлены: " + ", ".join(absent) if absent else "backend/requirements.txt"))
    try:
        from .exports import pdf_font
        checks.append(Check("pdf_font", "ok", str(pdf_font(settings))))
    except (RuntimeError, ImportError) as exc:
        checks.append(Check("pdf_font", "fail", str(exc)))
    try:
        settings.data_dir.mkdir(parents=True, exist_ok=True)
        probe = settings.data_dir / ".write-test"
        probe.write_text("ok")
        probe.unlink()
        checks.append(Check("data_dir", "ok", str(settings.data_dir)))
    except OSError as exc:
        checks.append(Check("data_dir", "fail", f"{settings.data_dir}: {exc}"))
    manifest = settings.stt_model_dir.parent / "manifest.json"
    if settings.stt_mode == "real" and manifest.is_file():
        entries = json.loads(manifest.read_text(encoding="utf-8")).get("files", [])
        broken = [e["path"] for e in entries if not (manifest.parent / e["path"]).is_file()
                  or (manifest.parent / e["path"]).stat().st_size != e["size"]]
        checks.append(Check("model_manifest", "fail" if broken else "ok",
                            f"не совпадают: {', '.join(broken[:3])}" if broken else f"{len(entries)} файлов совпадают"))
    return checks


def blocking(settings: Settings) -> list[Check]:
    return [c for c in model_checks(settings) if c.level == "fail"]


def as_dicts(checks: list[Check]) -> list[dict]:
    return [asdict(c) for c in checks]
