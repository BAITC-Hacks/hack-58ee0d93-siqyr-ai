# Siqyr AI — автопротоколирование совещаний

> Запись совещания на русском, казахском или шала-казахском → протокол, поручения с ответственными и сроками, напоминания. Работает в закрытом контуре.

**Демо:** _TODO: URL_ · **Видео:** _TODO: ссылка_ · Кейс HackAlem AI: [docs/TASK.md](docs/TASK.md)

## Проблема и пользователь
_TODO_

## Как это работает
_TODO: схема из docs/ARCHITECTURE.md_

```
запись ─► STT (своя модель, CPU) + диаризация ─► агенты: говорящие → поручения → сроки → саммари
       ─► секретарь проверяет и утверждает ─► DOCX/PDF + дашборд поручений + напоминания
```

## Быстрый старт (ноутбук, без Docker)

Нужно заранее: Python 3.12+, Node.js 20.19+/22.12+, для реальной обработки — FFmpeg и [Ollama](https://ollama.com). Сеть нужна только для установки.

```bash
bash scripts/setup.sh                      # .venv, зависимости по lock, .env, npm ci, проверка
bash scripts/run_local.sh --offline        # API 127.0.0.1:8000 + фронт 127.0.0.1:5174, ничего не скачивает
bash scripts/demo_e2e.sh                   # сквозная проверка: запуск → проверка → утверждение → DOCX + PDF
```

По умолчанию `.env` включает mock STT и mock-агентов на синтетическом совещании. Backend может работать без входа (`AUTH_MODE=disabled`), но для текущего фронтенда установите в `.env` `AUTH_MODE=local`, случайный `JWT_SECRET` длиной от 32 символов, `BOOTSTRAP_ADMIN_USER` и `BOOTSTRAP_ADMIN_PASSWORD` длиной от 12 символов. После первого запуска удалите bootstrap-пароль из окружения.

Реальная обработка на локальных моделях (один раз с сетью):

```bash
bash scripts/setup.sh --with-stt           # torch CPU, onnxruntime, pyannote и CLI hf
.venv/bin/hf auth login                    # Windows: .venv\Scripts\hf; токен не в git; принять условия pyannote на huggingface.co
bash scripts/setup.sh --download-models    # ollama pull qwen3:4b / qwen3:1.7b, веса STT и диаризации в models/, manifest
```
Откройте http://127.0.0.1:5174. Подробнее: [frontend/README.md](frontend/README.md).
Фронтенд подключён к API для входа по логину и паролю. Данные встреч и поручений пока остаются в браузере; их API, SSE и ИИ будут подключены отдельно.

Docker: `docker compose up --build` после настройки `.env`; API — http://localhost:8000/api/health, фронтенд — http://localhost:5173.

Затем в `.env`: `STT_MODE=real`, `AGENT_MODE=real`, `LLM_BASE_URL=http://127.0.0.1:11434/v1`. Запустите `ollama serve` и `bash scripts/run_local.sh --offline`. Своя запись: `bash scripts/demo_e2e.sh --file запись.wav --meeting-date 2026-09-23 --mode real`.

`scripts/preflight.py` проверяет Python, пакеты, шрифт с казахскими буквами, веса, FFmpeg и доступность модели в Ollama. Если чего-то нет, API отвечает 503 с понятной причиной и ничего не скачивает. `--offline` дополнительно запрещает LLM не на loopback.

| Переменная | По умолчанию | Смысл |
|---|---|---|
| `STT_MODE`, `AGENT_MODE` | `mock` | `real` — локальные STT и LLM; любой mock-этап помечает результат `source_mode=mock` |
| `DEMO_MODE` | `live` | `replay` — повтор сохранённого прогона, помечен `source_mode=replay` |
| `LLM_PROVIDER` | `local` | `dev_openai` разрешён только для синтетических запусков; облачного fallback нет |
| `LLM_BASE_URL` | пусто | обязателен для `AGENT_MODE=real`; пусто — real-запуск останавливается |
| `MODEL_MAIN`, `MODEL_FAST` | `qwen3:4b`, `qwen3:1.7b` | модели Ollama |
| `STT_MODEL_DIR`, `DIARIZATION_MODEL_DIR` | `models/stt`, `models/diarization` | веса; `models/` не коммитится |
| `DATA_DIR` | `data/runtime` | SQLite, загрузки, экспорты; удалить папку = удалить все данные |
| `MAX_UPLOAD_MB`, `MAX_QUEUE` | `100`, `3` | лимит файла (413) и очереди при одном worker (429) |
| `PDF_FONT_PATH` | поиск DejaVu Sans / Arial | TTF с ә ғ қ ң ө ұ ү һ і |

Тесты: `.venv/bin/python -m pytest` (Windows: `.venv\Scripts\python -m pytest`). Docker (`docker compose up --build`) — дополнительный способ, не основной.

Вход по логину/паролю, профиль с настройками и аватаром, права департаментов и подготовка Keycloak/NCALayer описаны в [docs/AUTH.md](docs/AUTH.md). После первого запуска уберите bootstrap-пароль из окружения.

## Агенты и инструменты
_TODO: таблица из docs/README_AI.md_

## Распознавание речи
Модель [alibiserikbay/kazakh-russian-mixed-stt](https://huggingface.co/alibiserikbay/kazakh-russian-mixed-stt) (Apache-2.0) — wav2vec2 + CTC,
казахский, русский и смешанная речь за один проход, работает на CPU. Обучена участником команды до хакатона.

## Результаты
_TODO: точность распознавания по языкам, точность поручений, стоимость и время прогона — из eval/results.md_

## Закрытый контур и приватность
_TODO_

## Структура
```
backend/app      API (FastAPI, SQLite, SSE, экспорт, напоминания)
backend/stt      распознавание речи и диаризация
backend/agents   агенты (OpenAI Agents SDK)
backend/shared   общий контракт
frontend         веб-интерфейс
infra            деплой
data             синтетические демо-данные
eval             оценка качества
docs             план, контракт, решения
```

## Команда
- Meiirlan — бэкенд, инфраструктура, интеграция
- Nurdaulet — фронтенд, демо
- Alibi — AI: распознавание речи, агенты, eval

Все демо-данные синтетические, имена вымышленные.
