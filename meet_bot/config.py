from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse


@dataclass(frozen=True)
class Config:
    api_base_url: str = os.getenv("API_BASE_URL", "http://127.0.0.1:8000")
    api_token: str = os.getenv("BOT_API_TOKEN", "")
    profile_dir: Path = Path(os.getenv("BOT_PROFILE_DIR", "meet_bot/.private/profile"))
    output_dir: Path = Path(os.getenv("OUTPUT_DIR", "meet_bot/.private/output"))
    chunk_seconds: int = int(os.getenv("CHUNK_SECONDS", "10"))
    admission_timeout_s: int = int(os.getenv("ADMISSION_TIMEOUT_S", "120"))
    alone_timeout_s: int = int(os.getenv("ALONE_TIMEOUT_S", "120"))
    max_duration_s: int = int(os.getenv("MAX_DURATION_S", "10800"))
    max_bots: int = int(os.getenv("MAX_BOTS", "1"))
    bind_host: str = os.getenv("BOT_BIND_HOST", "127.0.0.1")

    def validate(self) -> None:
        if not 1 <= self.chunk_seconds <= 60:
            raise ValueError("CHUNK_SECONDS должен быть от 1 до 60")
        if min(self.admission_timeout_s, self.alone_timeout_s, self.max_duration_s, self.max_bots) < 1:
            raise ValueError("Таймауты и MAX_BOTS должны быть положительными")
        parsed = urlparse(self.api_base_url)
        if parsed.scheme != "http" or parsed.hostname not in {"127.0.0.1", "localhost", "host.docker.internal"}:
            raise ValueError("API_BASE_URL должен указывать на локальный API")
        if self.bind_host not in {"127.0.0.1", "0.0.0.0"}:
            raise ValueError("BOT_BIND_HOST должен быть 127.0.0.1 или 0.0.0.0")
