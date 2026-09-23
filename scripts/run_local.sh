#!/usr/bin/env bash
# Запуск демо на ноутбуке: API 127.0.0.1:8000 + frontend 127.0.0.1:5174. Ничего не скачивает.
#   bash scripts/run_local.sh [--profile laptop] [--offline] [--api-only] [--port 8000]
# --offline  запрет сетевых обращений библиотек (HF, телеметрия, tracing); LLM только на loopback.
# Режимы и модели — из .env (AGENT_MODE, STT_MODE, LLM_*). Остановка: Ctrl+C.
set -euo pipefail
cd "$(dirname "$0")/.."

OFFLINE=0; API_ONLY=0; PORT=8000
while [ $# -gt 0 ]; do
  case "$1" in
    --profile) shift ;;
    --offline) OFFLINE=1 ;;
    --api-only) API_ONLY=1 ;;
    --port) PORT="$2"; shift ;;
    -h|--help) sed -n '2,6p' "$0"; exit 0 ;;
    *) echo "Неизвестный параметр: $1" >&2; exit 2 ;;
  esac
  shift
done

if [ -x .venv/bin/python ]; then VPY=.venv/bin/python; elif [ -f .venv/Scripts/python.exe ]; then VPY=.venv/Scripts/python.exe
else echo "Нет .venv: сначала bash scripts/setup.sh" >&2; exit 1; fi

# Никакой телеметрии и загрузок во время работы, даже без --offline.
export HF_HUB_DISABLE_TELEMETRY=1 PYANNOTE_METRICS_ENABLED=0 OPENAI_AGENTS_DISABLE_TRACING=1 DO_NOT_TRACK=1
if [ "$OFFLINE" = 1 ]; then
  export HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1
  PREFLIGHT_ARGS=--offline
else
  PREFLIGHT_ARGS=
fi

"$VPY" scripts/preflight.py $PREFLIGHT_ARGS || { echo "Preflight не пройден: см. FAIL выше." >&2; exit 1; }

port_busy() { "$VPY" -c "import socket,sys; s=socket.socket(); sys.exit(0 if s.connect_ex(('127.0.0.1', int(sys.argv[1]))) == 0 else 1)" "$1"; }
if port_busy "$PORT"; then echo "Порт $PORT занят: остановите прежний API или укажите --port." >&2; exit 1; fi
if [ "$API_ONLY" = 0 ] && port_busy 5174; then echo "Порт 5174 занят: остановите прежний frontend или используйте --api-only." >&2; exit 1; fi

PIDS=()
cleanup() { for pid in "${PIDS[@]:-}"; do kill "$pid" 2>/dev/null || true; done; wait 2>/dev/null || true; }
trap cleanup EXIT INT TERM

# Один worker: SSE-рассылка и очередь обработки живут в процессе.
"$VPY" -m uvicorn backend.app.main:app --host 127.0.0.1 --port "$PORT" --workers 1 &
PIDS+=($!)

for _ in $(seq 1 60); do
  if "$VPY" -c "import httpx,sys; sys.exit(0 if httpx.get('http://127.0.0.1:$PORT/api/health', timeout=1, trust_env=False).status_code == 200 else 1)" 2>/dev/null; then
    break
  fi
  sleep 0.5
done
"$VPY" -c "import httpx,json; print('health:', json.dumps(httpx.get('http://127.0.0.1:$PORT/api/health', trust_env=False).json(), ensure_ascii=False))" \
  || { echo "API не поднялся." >&2; exit 1; }

if [ "$API_ONLY" = 0 ]; then
  if [ ! -d frontend/node_modules ]; then echo "Нет frontend/node_modules: bash scripts/setup.sh (или --api-only)." >&2; exit 1; fi
  VITE_API_URL="http://127.0.0.1:$PORT" npm --prefix frontend run dev &
  PIDS+=($!)
  echo "Frontend: http://127.0.0.1:5174"
fi
echo "API: http://127.0.0.1:$PORT/api/health  (Ctrl+C — остановить)"
wait
