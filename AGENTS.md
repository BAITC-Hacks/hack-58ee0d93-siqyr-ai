# AGENTS.md — Siqyr AI

## Миссия
Кейс HackAlem «Система автопротоколирования совещаний с фиксацией поручений».
ТЗ: docs/TASK.md. Критерии: docs/CRITERIA.md. Демо: docs/DEMO.md. Стек: docs/STACK.md. Роли: docs/ROLES.md.

Запись совещания (ru / kk / шала-казахский) → STT + диаризация → агенты выделяют поручения
(кто, что, к какому сроку) и саммари → секретарь проверяет и утверждает → DOCX/PDF, дашборд поручений,
напоминания о сроках.

## Жёсткие ограничения из ТЗ
- Аудио и текст не уходят во внешние облачные API в режиме закрытого контура.
  STT — только self-hosted модель. LLM — через `LLM_BASE_URL` (OpenAI-совместимый клиент).
- Приватность: реальные записи анонимизируются, демо-данные синтетические и так помечены.
- Участники уведомляются, что идёт запись и транскрибация ИИ.

## Перед каждой задачей
git pull, затем docs/PLAN.md, docs/CONTRACT.md, docs/STATUS.md, docs/DECISIONS.md.

## Структура
```
backend/app/       API: FastAPI + SQLModel + SQLite, SSE, экспорт, напоминания   -> Meiirlan
backend/stt/       STT + диаризация: transcribe(audio, lang) -> list[Segment]   -> Alibi (модель), Meiirlan (сервис)
backend/agents/    propose()/execute(), runner_mock.py и runner.py, prompts/     -> Alibi
backend/shared/    schemas.py — общий контракт                                   -> Meiirlan + Alibi
frontend/          Vite + React + TS + Tailwind                                  -> Nurdaulet
infra/             Dockerfile фронта, nginx, заметки по деплою                   -> Meiirlan
data/seed/         синтетические демо-совещания и seed для БД                    -> Meiirlan
data/samples/      аудио для демо (синтетика, записали сами)                     -> Alibi
data/synthetic/    сгенерированные eval-данные                                   -> Alibi
eval/              run_eval.py, results.md                                       -> Alibi
tests/             pytest для API                                                -> Meiirlan
scripts/           demo_e2e, утилиты                                             -> все
docs/              план, контракт, статус                                        -> все (STATUS.md только дописывать)
```

## Запуск
- Всё: `docker compose up --build`
- API: `pip install -r backend/requirements.txt` → `uvicorn backend.app.main:app --reload` (из корня)
- Тесты: `pytest`
- Фронт: `cd frontend && pnpm dev`

## Стек
Определён в docs/STACK.md. Если STACK.md противоречит AGENTS.md или скиллу — прав STACK.md.

## Модели
- Основной поток: Sol. Разведка, логи, тесты: spawn scout.
- Не уверен в API OpenAI / Agents SDK / имени модели — спроси docs_researcher.
- Застрял >15 минут или меняем архитектуру — architect. Не для рутины.
- Перед мержем в main — reviewer. Проверка UI — ui_tester.

## Скиллы
$status-update, $contract-guard, $agents-sdk-patterns, $synthetic-data, $demo-check, $submission

## Правила
- Правь только свои папки. CONTRACT.md и backend/shared/schemas.py — только по согласию затронутых, с записью в docs/DECISIONS.md.
- Фронт и бэк работают против AGENT_MODE=mock и STT_MODE=mock, пока AI-полоса не скажет, что real готов.
- Все «простые» LLM-вызовы — через backend/app/llm.py. Имена моделей и ключи — только из .env.
- Готово = тесты проходят + демо-путь работает + $status-update.
- Никогда не коммить .env, *.db, реальные персональные данные и реальные записи совещаний.
