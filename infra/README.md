# Инфраструктура

| Что | Где | Команда | Владелец |
|---|---|---|---|
| Всё локально | `docker-compose.yml` | `docker compose up --build` | Meiirlan |
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

## Закрытый контур

Ни аудио, ни текст не уходят во внешние API:
- STT: модель `alibiserikbay/kazakh-russian-mixed-stt` на CPU внутри контейнера `api`.
- LLM: `LLM_BASE_URL=http://<vllm-host>:8000/v1` — vLLM с открытой моделью (gpt-oss) на своей GPU.

## Жюри, 24–28 сентября

GPU на всю неделю не держим. Публичный URL: `DEMO_MODE=replay` для агентов + STT на CPU.
Полный пайплайн — `docker compose up` по README.
