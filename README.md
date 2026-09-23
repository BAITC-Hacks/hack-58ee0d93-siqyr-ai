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

## Быстрый старт

Одной командой (Docker):
```bash
cp .env.example .env
# По умолчанию AUTH_MODE=disabled — демо без входа, секреты не нужны.
# Для входа по логину: AUTH_MODE=local, JWT_SECRET (>=32 символов),
# BOOTSTRAP_ADMIN_USER и BOOTSTRAP_ADMIN_PASSWORD (>=12 символов).
docker compose up --build
```
API: http://localhost:8000/api/health · Фронт: http://localhost:5173

Без Docker:
```bash
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r backend/requirements.txt
uvicorn backend.app.main:app --reload
pytest
```

Фронтенд отдельно (Node.js 20.19+ в ветке 20.x или 22.12+):
```bash
cd frontend
npm ci
npm run dev
```
Откройте http://127.0.0.1:5174. Подробнее: [frontend/README.md](frontend/README.md).
Фронтенд пока хранит данные в браузере; API, SSE и ИИ будут подключены отдельно.

Режимы (`.env`): `AGENT_MODE=mock|real`, `STT_MODE=mock|real`, `DEMO_MODE=live|replay`, `LLM_BASE_URL` — пусто для OpenAI API или адрес self-hosted vLLM.

Вход по логину/паролю, права департаментов и подготовка Keycloak/NCALayer описаны в [docs/AUTH.md](docs/AUTH.md). После первого запуска уберите bootstrap-пароль из окружения.

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
