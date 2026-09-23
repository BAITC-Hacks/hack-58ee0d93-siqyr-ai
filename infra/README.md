# Инфраструктура

| Что | Где | Команда | Владелец |
|---|---|---|---|
| Всё локально | `docker-compose.yml` | `docker compose up --build` | Meiirlan |
| Закрытый контур (on-premise) | `docker-compose.yml` + `./models` | см. ниже | Meiirlan |
| Бэкенд (API + STT на CPU) | Railway, `railway.toml` → `backend/Dockerfile` | `railway up` | Meiirlan |
| Фронтенд | Vercel, папка `frontend/` | `vercel deploy` | Nurdaulet |
| Локальная LLM (закрытый контур) | NVIDIA Brev, vLLM с gpt-oss | см. ниже | Alibi |

## Переменные Railway

`OPENAI_API_KEY` (прод-ключ), `AGENT_MODE`, `STT_MODE`, `DEMO_MODE`, `MODEL_MAIN`, `MODEL_FAST`,
`CORS_ORIGINS` (URL фронта на Vercel), `WITH_STT=1` (ставит torch и модель, образ тяжелее).
PyTorch + модель `rukk` занимают ~2 ГБ RAM — проверить лимиты сервиса.
Без подключённого volume база и загрузки на Railway стираются при каждом деплое.

## Переменные Vercel

`VITE_API_URL` = публичный URL Railway, `VITE_FAKE=0`.

## Закрытый контур (docker compose)

Аудио, текст встреч и их производные не покидают сервер: STT, диаризация, LLM и RAG работают в контейнерах,
веса читаются из `./models` (только чтение), во время работы ничего не скачивается (`HF_HUB_OFFLINE=1`).

```
браузер ──► web :80 (nginx: фронт + /api) ──► api :8000 (FastAPI, STT, диаризация; RAG-сервис на Unix socket)
                                                  └──► ollama :11434 (LLM, профиль llm; порт не публикуется)
```

Наружу открыт только порт web (`WEB_LISTEN`); API в обход nginx — на 127.0.0.1 сервера (`API_PORT`).
LLM разрешена протоколам и RAG-чату только на loopback или на хостах из `LLM_ALLOWED_HOSTS`; compose сам добавляет `ollama`.

### 1. Подготовка на машине с интернетом

```bash
bash scripts/setup.sh --download-models --download-rag-models   # веса в models/stt, models/diarization, models/rag
# .env: PUBLIC_APP_URL=https://siqyr.company.kz (адрес для пользователей, вшивается в web), WITH_STT=1, WITH_RAG=1
docker compose build
docker compose --profile llm up -d ollama
docker compose exec ollama ollama pull qwen3:4b                  # MODEL_MAIN и MODEL_FAST из .env -> models/ollama
docker compose exec ollama ollama pull qwen3:1.7b
docker compose down
docker save siqyr-api siqyr-web ollama/ollama:0.34.3 | gzip > siqyr-images.tar.gz
```

На сервер переносятся `siqyr-images.tar.gz`, папка `models/` и репозиторий (нужны `docker-compose.yml`, `.env.example`).

### 2. Запуск на сервере

```bash
docker load -i siqyr-images.tar.gz
cp .env.example .env                                            # заполнить по таблице ниже
docker compose up -d --no-build --wait
curl -s http://127.0.0.1:8000/api/health                         # ready: true, problems: [], rag.service: true
```

| Переменная | Значение в контуре |
|---|---|
| `PUBLIC_APP_URL` | тот же адрес, что при сборке web |
| `WEB_LISTEN` | `0.0.0.0:80` |
| `AUTH_MODE` | `keycloak`, `hybrid` или `local` + `JWT_SECRET`, `KEYCLOAK_*` ([docs/AUTH.md](../docs/AUTH.md)); `disabled` открывает всё любому в сети |
| `STT_MODE`, `AGENT_MODE` | `real` |
| `WITH_STT`, `WITH_RAG` | `1` |
| `COMPOSE_PROFILES` | `llm` |
| `LLM_PROVIDER`, `DOCKER_LLM_BASE_URL` | `local`, пусто (Ollama из профиля `llm`) |
| `SMTP_HOST` | внутренний relay; `RESEND_API_KEY` пустой |
| `JIRA_URL` | Jira Data Center в контуре; `JIRA_ALLOW_CLOUD` пустой |

LLM на отдельном GPU-сервере контура (vLLM): `DOCKER_LLM_BASE_URL=http://gpu01:8000/v1`, `LLM_ALLOWED_HOSTS=gpu01`,
профиль `llm` не нужен. Протоколы и RAG-чат работают с этим сервером.

Ограничения:
- HTTPS терминирует балансировщик заказчика перед web либо сертификат добавляется в `infra/nginx.conf`.
- Образ web собран под один `PUBLIC_APP_URL`; другой адрес — пересборка web.
- Фронт работает с сервером (записи, реестр, RAG-чат) только если API на `localhost` или на том же адресе, что и страница
  (`frontend/src/shared/domain/ownServer.ts`): открывайте приложение по `PUBLIC_APP_URL`, а не по IP.

## Жюри, 24–28 сентября

GPU на всю неделю не держим. Публичный URL: `DEMO_MODE=replay` для агентов + STT на CPU.
Полный пайплайн — `docker compose up` по README.
