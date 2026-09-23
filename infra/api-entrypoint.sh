#!/bin/sh
# Процессы контейнера api. Образ с WITH_RAG=1 дополнительно поднимает приватный RAG AI-сервис
# на Unix socket, как scripts/run_local.sh --with-rag: портов у него нет, API ходит к нему через сокет.
set -eu

if python -c "import importlib.util, sys; sys.exit(importlib.util.find_spec('sentence_transformers') is None)"; then
  SOCKET=$(python -c 'from backend.app.config import Settings; print(Settings().rag_ai_socket)')
  mkdir -p "$(dirname "$SOCKET")"
  chmod 700 "$(dirname "$SOCKET")"
  (
    umask 077
    # При падении сервис поднимается снова: чат возвращается без перезапуска контейнера.
    while true; do
      rm -f "$SOCKET"
      uvicorn backend.agents.rag_service:app --uds "$SOCKET" --workers 1 || true
      sleep 2
    done
  ) &
fi

# Один worker: SSE-рассылка и очередь обработки живут в процессе.
exec uvicorn backend.app.main:app --host 0.0.0.0 --port "${PORT:-8000}" --workers 1
