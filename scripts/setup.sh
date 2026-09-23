#!/usr/bin/env bash
# Однократная подготовка (нужна сеть): .venv, зависимости, .env, frontend, по желанию веса моделей.
#   bash scripts/setup.sh [--profile laptop] [--with-stt] [--with-rag] [--download-rag-models] [--download-models] [--no-lock] [--skip-frontend]
# --with-stt         torch (CPU) + onnxruntime + pyannote для STT_MODE=real
# --download-models  ollama pull + веса STT/диаризации в models/ (нужен hf auth login и принятые условия pyannote)
# После setup работа идёт без сети: scripts/run_local.sh --offline ничего не скачивает.
set -euo pipefail
cd "$(dirname "$0")/.."

WITH_STT=0; WITH_RAG=0; DOWNLOAD_RAG=0; DOWNLOAD=0; USE_LOCK=1; FRONTEND=1
while [ $# -gt 0 ]; do
  case "$1" in
    --profile) shift ;;  # единственный профиль — laptop
    --with-stt) WITH_STT=1 ;;
    --download-models) DOWNLOAD=1; WITH_STT=1 ;;
    --with-rag) WITH_RAG=1 ;;
    --download-rag-models) DOWNLOAD_RAG=1; WITH_RAG=1 ;;
    --no-lock) USE_LOCK=0 ;;
    --skip-frontend) FRONTEND=0 ;;
    -h|--help) sed -n '2,7p' "$0"; exit 0 ;;
    *) echo "Неизвестный параметр: $1" >&2; exit 2 ;;
  esac
  shift
done

step() { printf '\n==> %s\n' "$*"; }

step "Python >= 3.12"
PY=""
for candidate in python3.12 python3.13 python3 python; do
  if command -v "$candidate" >/dev/null 2>&1 && "$candidate" -c 'import sys; sys.exit(sys.version_info < (3, 12))' 2>/dev/null; then
    PY="$candidate"; break
  fi
done
[ -z "$PY" ] && command -v py >/dev/null 2>&1 && py -3.12 -c '' 2>/dev/null && PY="py -3.12"
[ -z "$PY" ] && { echo "Нужен Python 3.12+ (python.org или brew install python@3.12)." >&2; exit 1; }
$PY --version

if [ ! -d .venv ]; then
  step "Создаю .venv"
  $PY -m venv .venv
fi
if [ -x .venv/bin/python ]; then VPY=.venv/bin/python; else VPY=.venv/Scripts/python.exe; fi

step "Зависимости API"
"$VPY" -m pip install --quiet --upgrade pip
if [ "$USE_LOCK" = 1 ] && [ -f backend/requirements.lock.txt ]; then
  "$VPY" -m pip install --quiet -r backend/requirements.lock.txt \
    || { echo "Lock не установился на этой платформе: повторите с --no-lock." >&2; exit 1; }
else
  "$VPY" -m pip install --quiet -r backend/requirements.txt
fi

if [ "$WITH_STT" = 1 ]; then
  step "Зависимости STT и диаризации (CPU)"
  "$VPY" -m pip install --quiet --extra-index-url https://download.pytorch.org/whl/cpu -r backend/requirements-stt.txt
  "$VPY" -m pip install --quiet "pyannote.audio==4.0.7" || echo "WARN: pyannote.audio не установился — диаризация недоступна." >&2
fi

if [ "$WITH_RAG" = 1 ]; then
  step "Локальные зависимости embeddings и rerank"
  "$VPY" -m pip install --quiet -r backend/requirements-rag.txt
fi

if [ ! -f .env ]; then
  step "Создаю .env из .env.example (секретов в нём нет)"
  cp .env.example .env
fi

if [ "$FRONTEND" = 1 ]; then
  step "Frontend (npm ci)"
  if command -v npm >/dev/null 2>&1; then npm --prefix frontend ci --no-audit --no-fund; else echo "WARN: npm не найден — фронт не установлен." >&2; fi
fi

if [ "$DOWNLOAD" = 1 ]; then
  MAIN=$(grep -E '^MODEL_MAIN=' .env | cut -d= -f2-); MAIN=${MAIN:-qwen3:4b}
  FAST=$(grep -E '^MODEL_FAST=' .env | cut -d= -f2-); FAST=${FAST:-qwen3:1.7b}
  step "LLM через Ollama: $MAIN, $FAST"
  if command -v ollama >/dev/null 2>&1; then
    ollama pull "$MAIN"
    ollama pull "$FAST" || echo "WARN: резервная модель $FAST не скачалась." >&2
  else
    echo "WARN: ollama не найдена — установите с ollama.com, затем: ollama pull $MAIN" >&2
  fi
  step "Веса STT (только asr/rukk, vad и config, не весь репозиторий 9 ГБ)"
  if [ -x .venv/bin/hf ]; then HF=.venv/bin/hf; else HF=.venv/Scripts/hf.exe; fi
  "$HF" download alibiserikbay/kazakh-russian-mixed-stt --include 'asr/rukk/*' 'vad/*' config.json --local-dir models/stt
  step "Веса диаризации pyannote (gated: сначала hf auth login и принять условия на huggingface.co)"
  "$HF" download pyannote/speaker-diarization-community-1 --local-dir models/diarization \
    || echo "WARN: нет доступа к pyannote. Примите условия модели и выполните hf auth login, затем повторите." >&2
  step "Manifest весов"
  STT_MODE=real "$VPY" scripts/preflight.py --write-manifest || true
fi

if [ "$DOWNLOAD_RAG" = 1 ]; then
  step "Локальные веса RAG (скачиваются только во время setup)"
  "$VPY" -m scripts.download_rag_models
fi

step "Проверка готовности"
"$VPY" scripts/preflight.py || echo "Есть ошибки выше: для демо на mock это нормально, для real — исправьте." >&2
printf '\nГотово. Запуск: bash scripts/run_local.sh --offline\n'
