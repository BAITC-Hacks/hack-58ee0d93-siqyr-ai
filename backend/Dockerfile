# Бэкенд: API + (опционально) STT на CPU. Контекст сборки — корень репо.
FROM python:3.12-slim

ARG WITH_STT=0
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1

# ffmpeg — перевод любых записей в 16 кГц моно; DejaVu — казахские буквы в PDF
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY backend/requirements.txt backend/requirements-stt.txt backend/
RUN pip install -r backend/requirements.txt \
    && if [ "$WITH_STT" = "1" ]; then \
         pip install --extra-index-url https://download.pytorch.org/whl/cpu -r backend/requirements-stt.txt; \
       fi

COPY backend/ backend/
COPY data/seed/ data/seed/
COPY data/samples/ data/samples/

ENV DATA_DIR=/data PORT=8000
EXPOSE 8000
CMD ["sh", "-c", "uvicorn backend.app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
