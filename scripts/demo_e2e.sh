#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")/.."
if [ -x .venv/bin/python ]; then
  exec .venv/bin/python scripts/demo_e2e.py "$@"
elif [ -f .venv/Scripts/python.exe ]; then
  exec .venv/Scripts/python.exe scripts/demo_e2e.py "$@"
else
  exec python scripts/demo_e2e.py "$@"
fi
