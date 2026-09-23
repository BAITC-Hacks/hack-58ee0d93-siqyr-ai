# Бэкенд: API + (опционально) STT и RAG на CPU. Контекст сборки — корень репо.
# Веса моделей в образ не входят: compose монтирует ./models в /app/models только для чтения.
FROM python:3.12-slim

ARG WITH_STT=0
ARG WITH_RAG=0
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
# Закрытый контур: библиотеки не ходят в Hugging Face, телеметрия и tracing выключены.
ENV HF_HUB_OFFLINE=1 HF_HUB_DISABLE_TELEMETRY=1 PYANNOTE_METRICS_ENABLED=0 OPENAI_AGENTS_DISABLE_TRACING=1

# ffmpeg — перевод любых записей в 16 кГц моно; DejaVu — казахские буквы в PDF
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY backend/requirements.lock.txt backend/requirements-stt.txt backend/requirements-rag.txt backend/
COPY infra/ml-constraints.txt infra/
RUN pip install -r backend/requirements.lock.txt \
    && ML="" \
    && if [ "$WITH_STT" = "1" ]; then ML="$ML -r backend/requirements-stt.txt"; fi \
    && if [ "$WITH_RAG" = "1" ]; then ML="$ML -r backend/requirements-rag.txt"; fi \
    && if [ -n "$ML" ]; then \
         pip install --extra-index-url https://download.pytorch.org/whl/cpu -c infra/ml-constraints.txt $ML; \
       fi

COPY backend/ backend/
COPY data/seed/ data/seed/
COPY data/samples/ data/samples/
COPY infra/api-entrypoint.sh infra/

ENV DATA_DIR=/data PORT=8000
EXPOSE 8000
CMD ["sh", "infra/api-entrypoint.sh"]
