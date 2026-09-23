"""Verify explicitly approved test audio against a server-owned SHA-256 manifest.

Manifest: {"version": 1, "files": [{"sha256": "<64 lowercase hex>",
"allow_dev_openai": true, "synthetic": true, "description": "approved test"}]}.
Only explicitly approved fictional fixtures may use the hosted development LLM.
This module never reads an approval claim from an API request.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class VerifiedAudio:
    path: Path
    sha256: str
    synthetic: bool
    signature: tuple[int, ...]


def _signature(info: os.stat_result) -> tuple[int, ...]:
    return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns)


def _manifest(path: Path | None) -> dict[str, dict]:
    if path is None:
        raise ValueError(
            "Внешний LLM разрешён только для проверенных синтетических образцов или явно "
            "разрешённых тестов: задайте серверный DEV_OPENAI_AUDIO_MANIFEST."
        )
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise ValueError("Не удалось прочитать серверный DEV_OPENAI_AUDIO_MANIFEST.") from exc
    if (not isinstance(document, dict) or type(document.get("version")) is not int
            or document["version"] != 1 or not isinstance(document.get("files"), list)):
        raise ValueError("DEV_OPENAI_AUDIO_MANIFEST должен содержать version=1 и массив files.")
    entries = {}
    for entry in document["files"]:
        if (not isinstance(entry, dict) or not isinstance(entry.get("sha256"), str)
                or re.fullmatch(r"[0-9a-f]{64}", entry["sha256"]) is None
                or type(entry.get("allow_dev_openai")) is not bool
                or type(entry.get("synthetic")) is not bool):
            raise ValueError("Запись DEV_OPENAI_AUDIO_MANIFEST требует SHA-256 и явные boolean allow_dev_openai/synthetic.")
        if entry["sha256"] in entries:
            raise ValueError("DEV_OPENAI_AUDIO_MANIFEST содержит повторный SHA-256.")
        entries[entry["sha256"]] = entry
    return entries


def verify_audio(audio_path: str, manifest_path: Path | None,
                 previous: VerifiedAudio | None = None) -> VerifiedAudio:
    """Hash once per proposal; recheck file identity and approval before LLM use."""
    entries = _manifest(manifest_path)
    try:
        path = Path(audio_path).resolve(strict=True)
        signature = _signature(path.stat())
        if previous is not None:
            if path != previous.path or signature != previous.signature:
                raise ValueError("Аудиофайл изменился после проверки SHA-256; создайте новый запуск.")
            digest = previous.sha256
        else:
            with path.open("rb") as source:
                if _signature(os.fstat(source.fileno())) != signature:
                    raise ValueError("Аудиофайл изменился во время проверки SHA-256.")
                digest = hashlib.file_digest(source, "sha256").hexdigest()
                if (_signature(os.fstat(source.fileno())) != signature
                        or _signature(path.stat()) != signature):
                    raise ValueError("Аудиофайл изменился во время проверки SHA-256.")
    except OSError as exc:
        raise ValueError("Не удалось прочитать аудиофайл для проверки SHA-256.") from exc
    entry = entries.get(digest)
    if entry is None or not entry["allow_dev_openai"]:
        raise ValueError(
            "SHA-256 аудиофайла не разрешён в серверном DEV_OPENAI_AUDIO_MANIFEST; "
            "добавьте явно одобренный тест или используйте local."
        )
    if not entry["synthetic"]:
        raise ValueError("Внешний LLM допускает только полностью вымышленные тестовые записи.")
    return VerifiedAudio(path, digest, entry["synthetic"], signature)
