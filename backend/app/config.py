"""Настройки из окружения (.env в корне репо). Имена моделей и ключи — только отсюда."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]
load_dotenv(ROOT / ".env")


def _env(name: str, default: str = "") -> str:
    return os.getenv(name, default).strip()


def _int(name: str, default: int) -> int:
    return int(_env(name, str(default)) or default)


def _float(name: str, default: float) -> float:
    return float(_env(name, str(default)) or default)


def _path(name: str, default: str) -> Path:
    p = Path(_env(name, default) or default)
    return p if p.is_absolute() else ROOT / p


@dataclass(frozen=True)
class Settings:
    agent_mode: str = field(default_factory=lambda: _env("AGENT_MODE", "mock"))  # mock | real
    stt_mode: str = field(default_factory=lambda: _env("STT_MODE", "mock"))  # mock | real
    demo_mode: str = field(default_factory=lambda: _env("DEMO_MODE", "live"))  # live | replay
    replay_run_id: str = field(default_factory=lambda: _env("REPLAY_RUN_ID"))
    mock_delay: float = field(default_factory=lambda: _float("MOCK_DELAY", 1))

    llm_base_url: str = field(default_factory=lambda: _env("LLM_BASE_URL"))  # обязательный явный endpoint
    llm_api_key: str = field(default_factory=lambda: _env("LLM_API_KEY"))
    model_main: str = field(default_factory=lambda: _env("MODEL_MAIN", "gpt-6-luna"))
    model_fast: str = field(default_factory=lambda: _env("MODEL_FAST", "gpt-6-luna"))
    price_in_per_1m: float = field(default_factory=lambda: _float("PRICE_IN_PER_1M", 0))
    price_out_per_1m: float = field(default_factory=lambda: _float("PRICE_OUT_PER_1M", 0))

    data_dir: Path = field(default_factory=lambda: _path("DATA_DIR", "data/runtime"))
    cors_origins: list[str] = field(
        default_factory=lambda: [o.strip() for o in _env("CORS_ORIGINS", "http://localhost:5173,http://localhost:5174,http://127.0.0.1:5174").split(",") if o.strip()]
    )
    cors_origin_regex: str = field(default_factory=lambda: _env("CORS_ORIGIN_REGEX", r"https://.*\.vercel\.app"))
    rate_limit_per_min: int = field(default_factory=lambda: _int("RATE_LIMIT_PER_MIN", 10))
    max_upload_mb: int = field(default_factory=lambda: _int("MAX_UPLOAD_MB", 100))

    reminder_interval_sec: int = field(default_factory=lambda: _int("REMINDER_INTERVAL_SEC", 300))
    remind_days_before: int = field(default_factory=lambda: _int("REMIND_DAYS_BEFORE", 1))
    utc_offset_hours: int = field(default_factory=lambda: _int("APP_UTC_OFFSET", 5))  # Астана
    demo_today: str = field(default_factory=lambda: _env("DEMO_TODAY"))  # YYYY-MM-DD, для демо
    seed: bool = field(default_factory=lambda: _env("SEED", "1") == "1")

    auth_mode: str = field(default_factory=lambda: _env("AUTH_MODE", "disabled"))  # disabled (демо, без входа) | local | keycloak | hybrid
    jwt_secret: str = field(default_factory=lambda: _env("JWT_SECRET"))
    jwt_issuer: str = field(default_factory=lambda: _env("JWT_ISSUER", "siqyr-ai"))
    jwt_ttl_minutes: int = field(default_factory=lambda: _int("JWT_TTL_MINUTES", 30))
    bootstrap_admin_user: str = field(default_factory=lambda: _env("BOOTSTRAP_ADMIN_USER"))
    bootstrap_admin_password: str = field(default_factory=lambda: _env("BOOTSTRAP_ADMIN_PASSWORD"))
    keycloak_issuer: str = field(default_factory=lambda: _env("KEYCLOAK_ISSUER"))
    keycloak_audience: str = field(default_factory=lambda: _env("KEYCLOAK_AUDIENCE"))
    ecp_verify_url: str = field(default_factory=lambda: _env("ECP_VERIFY_URL"))

    pdf_font_path: str = field(default_factory=lambda: _env("PDF_FONT_PATH"))
    pdf_font_bold_path: str = field(default_factory=lambda: _env("PDF_FONT_BOLD_PATH"))

    @property
    def db_path(self) -> Path:
        return self.data_dir / "siqyr.db"

    @property
    def uploads_dir(self) -> Path:
        return self.data_dir / "uploads"

    @property
    def exports_dir(self) -> Path:
        return self.data_dir / "exports"


settings = Settings()


def today(config: Settings | None = None) -> date:
    config = config or settings
    if config.demo_today:
        return date.fromisoformat(config.demo_today)
    return datetime.now(timezone(timedelta(hours=config.utc_offset_hours))).date()
