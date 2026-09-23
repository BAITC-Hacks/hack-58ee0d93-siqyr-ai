"""Проверка готовности перед демо: окружение, веса, LLM. Ничего не скачивает.

    python scripts/preflight.py [--offline] [--write-manifest]

--offline        LLM не на loopback — ошибка, а не предупреждение.
--write-manifest записать models/manifest.json (путь, размер, sha256) после setup.
Код выхода 1, если есть ошибки (fail).
"""
import argparse
import hashlib
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.app.config import Settings  # noqa: E402
from backend.app.readiness import Check, environment_checks, model_checks, probe_llm  # noqa: E402

MARK = {"ok": "OK  ", "warn": "WARN", "fail": "FAIL"}


def write_manifest(settings: Settings) -> Path:
    root = settings.stt_model_dir.parent
    files = []
    for directory in (settings.stt_model_dir, settings.diarization_model_dir):
        for path in sorted(p for p in directory.rglob("*") if p.is_file() and ".cache" not in p.parts):
            digest = hashlib.sha256()
            with path.open("rb") as handle:
                for chunk in iter(lambda: handle.read(1 << 20), b""):
                    digest.update(chunk)
            files.append({"path": path.relative_to(root).as_posix(), "size": path.stat().st_size, "sha256": digest.hexdigest()})
    target = root / "manifest.json"
    target.write_text(json.dumps({"stt_repo": "alibiserikbay/kazakh-russian-mixed-stt",
                                  "diarization_repo": "pyannote/speaker-diarization-community-1",
                                  "llm": [settings.model_main, settings.model_fast], "files": files}, ensure_ascii=False, indent=1),
                      encoding="utf-8")
    return target


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--offline", action="store_true")
    parser.add_argument("--write-manifest", action="store_true")
    args = parser.parse_args()
    settings = Settings()
    if args.write_manifest:
        print(f"manifest: {write_manifest(settings)}")
    checks = environment_checks(settings) + model_checks(settings)
    if settings.agent_mode == "real" and settings.llm_base_url:
        checks.append(probe_llm(settings))
    if args.offline:
        checks = [Check(c.name, "fail", c.detail + " (запрещено в --offline)") if c.name == "llm_endpoint" and c.level == "warn" else c
                  for c in checks]
    print(f"Режимы: STT_MODE={settings.stt_mode} AGENT_MODE={settings.agent_mode} DEMO_MODE={settings.demo_mode} "
          f"LLM_PROVIDER={settings.llm_provider} AUTH_MODE={settings.auth_mode}")
    for check in checks:
        print(f"[{MARK[check.level]}] {check.name:20} {check.detail}")
    failed = [c for c in checks if c.level == "fail"]
    print("Готово к запуску." if not failed else f"Не готово: {len(failed)} ошибок.")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
