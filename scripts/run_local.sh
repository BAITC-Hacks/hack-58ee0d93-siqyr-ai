#!/usr/bin/env bash
# Запуск демо на ноутбуке: API 127.0.0.1:8000 + frontend 127.0.0.1:5174. Ничего не скачивает.
#   bash scripts/run_local.sh [--profile laptop] [--offline] [--with-rag] [--api-only] [--port 8000]
# --offline  запрет сетевых обращений библиотек (HF, телеметрия, tracing); LLM только на loopback.
# Режимы и модели — из .env (AGENT_MODE, STT_MODE, LLM_*). Остановка: Ctrl+C.
set -euo pipefail
cd "$(dirname "$0")/.."

OFFLINE=0; WITH_RAG=0; API_ONLY=0; PORT=8000
while [ $# -gt 0 ]; do
  case "$1" in
    --profile) shift ;;
    --offline) OFFLINE=1 ;;
    --with-rag) WITH_RAG=1 ;;
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
RAG_SOCKET=""
cleanup() { for pid in "${PIDS[@]:-}"; do kill "$pid" 2>/dev/null || true; done; wait 2>/dev/null || true; if [ -n "$RAG_SOCKET" ]; then rm -f "$RAG_SOCKET"; fi; }
trap cleanup EXIT INT TERM

if [ "$WITH_RAG" = 1 ]; then
  RAG_SOCKET=$("$VPY" -c 'from backend.app.config import Settings; print(Settings().rag_ai_socket)')
  mkdir -p "$(dirname "$RAG_SOCKET")"
  if [ -S "$RAG_SOCKET" ]; then
    if "$VPY" -c 'import httpx,sys; c=httpx.Client(transport=httpx.HTTPTransport(uds=sys.argv[1]),base_url="http://rag-ai",timeout=1,trust_env=False); sys.exit(0 if c.get("/internal/health").status_code==200 else 1)' "$RAG_SOCKET" 2>/dev/null; then
      echo "Внутренний AI-сервис уже запущен: $RAG_SOCKET" >&2; exit 1
    fi
    rm -f "$RAG_SOCKET"
  fi
  umask 077
  "$VPY" -m uvicorn backend.agents.rag_service:app --uds "$RAG_SOCKET" --workers 1 &
  PIDS+=($!)
  for _ in $(seq 1 60); do [ -S "$RAG_SOCKET" ] && break; sleep 0.5; done
  if [ ! -S "$RAG_SOCKET" ]; then echo "AI-сервис RAG не запустился." >&2; exit 1; fi
  echo "RAG AI: Unix socket $RAG_SOCKET"
fi

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
