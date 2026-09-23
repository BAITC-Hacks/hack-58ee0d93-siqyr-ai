# AGENTS.md — Siqyr AI

## Миссия
Кейс HackAlem «Система автопротоколирования совещаний с фиксацией поручений».
ТЗ: docs/TASK.md. Критерии: docs/CRITERIA.md. Демо: docs/DEMO.md. Стек: docs/STACK.md. Роли: docs/ROLES.md.

Запись совещания (ru / kk / шала-казахский) → STT + диаризация → агенты выделяют поручения
(кто, что, к какому сроку) и саммари → секретарь проверяет источник и утверждает → DOCX/PDF.
Дашборд и напоминания — после ядра, по cut list docs/PLAN.md. До 16:15 работаем только над этим MVP.

## Жёсткие ограничения из ТЗ
- Аудио, текст встреч и их производные не уходят во внешние облачные API. STT/LLM рабочего сценария локальные.
- Разработка сначала через OpenAI API допускается только на полностью вымышленных fixtures с проверенным manifest, затем тот же контракт переключается на local. Нельзя принимать synthetic=true от клиента за достаточное доказательство.
- Local — профиль по умолчанию: пустой/произвольный внешний `LLM_BASE_URL` останавливает real-run. Никакого fallback в OpenAI при ошибке local. Отключить Agents tracing/телеметрию и внешние UI assets.
- Brev уже настроен, бюджет $50; до подтверждения организаторами контура — только синтетические тесты/GPU-эксперименты. SSH localhost не означает, что данные остаются на ноутбуке. API-бюджет $50 на предоставленный ключ; число ключей не предполагать.
- Приватность: реальные записи анонимизируются для публичной демонстрации; происхождение исходных файлов ещё нужно проверить. Собственная сценарная запись и mock явно подписаны, не объявлять все файлы синтетикой автоматически.
- Участники уведомляются, что идёт запись и транскрибация ИИ.

## Перед каждой задачей
Сначала git status, затем docs/COORDINATION.md, docs/PLAN.md, docs/CONTRACT.md, docs/STATUS.md, docs/DECISIONS.md. Сохранять текущую работу каждого участника; продолжать существующий frontend без пересоздания. Не выполнять pull поверх незавершённой работы. Пользовательский planning-only запрос разрешает только документацию, не реализацию.

## Структура
```
backend/app/       API: FastAPI + SQLModel + SQLite, SSE, review, экспорт      -> Meiirlan
backend/stt/       STT + диаризация: transcribe(audio, lang) -> list[Segment]   -> Alibi; Meiirlan интегрирует
backend/agents/    propose()/execute(), runner_mock.py и runner.py, prompts/     -> Alibi
backend/shared/    schemas.py — общий контракт                                   -> Meiirlan после согласования с Alibi
frontend/          Vite + React + TS + Mantine + Dexie                            -> Nurdaulet
infra/             Dockerfile фронта, nginx, заметки по деплою                   -> Meiirlan
data/seed/         синтетические демо-совещания и seed для БД                    -> Meiirlan
data/samples/      аудио для демо (синтетика, записали сами)                     -> Alibi
data/synthetic/    сгенерированные eval-данные                                   -> Alibi
evaluation/, eval/ baseline, audio adjudication, raw/reviewed eval                -> Alibi
tests/             pytest для API                                                -> Meiirlan
scripts/           demo_e2e, утилиты                                             -> Meiirlan
docs/              общие CONTRACT/STATUS/DECISIONS                                -> Meiirlan
docs/handoffs/     личный отчёт участника                                         -> каждый только свой файл
```

## Запуск
- Основной путь: localhost без Docker, см. docs/STACK.md. `scripts/setup.sh`, `scripts/run_local.sh`, `scripts/preflight.py` реализованы (cc4d99b); проверены в mock на Windows/Git Bash, real-путь и Mac — ещё нет.
- API: `uvicorn backend.app.main:app --host 127.0.0.1 --port 8000` из проверенного env и с настройками STACK.md.
- Тесты: `pytest`
- Фронт: `npm --prefix frontend run dev`, порт 5174; зависимости через `npm --prefix frontend ci`.

## Стек
Реализованный frontend и его package-lock сохраняются; детали в docs/STACK.md. backend/ML версии там — целевой план до smoke. При расхождении со старым планом следовать текущему работающему коду и docs/COORDINATION.md; API-изменения согласовывать с владельцем.

## Модели
- Не уверен в API OpenAI / Agents SDK / имени модели — спроси docs_researcher.
- Не трать больше 15 минут на обходной стек; эскалируй blocker Meiirlan и применяй cut list. Делегирование — только для конкретной независимой задачи, не вместо полезной локальной работы.
- Перед мержем — review затронутой полосы и demo smoke; ui_tester при доступности.

## Скиллы
$status-update, $contract-guard, $agents-sdk-patterns, $synthetic-data, $demo-check, $submission

## Правила
- Правь только свои папки. CONTRACT.md и backend/shared/schemas.py — только по согласию затронутых, с записью в docs/DECISIONS.md.
- Фронт и бэк стартуют против mock, пока real не готов. Режимы явно подписаны. Hosted synthetic smoke к 14:15, local smoke до 15:00, real end-to-end к 15:30, freeze 16:15.
- Все «простые» LLM-вызовы — через backend/app/llm.py. Имена моделей и ключи — только из .env.
- Один structured вызов для propose допустим; SDK и несколько агентов не требуются. execute не вызывает LLM после approval и не рассылает сообщения.
- docs/CONTRACT.md — v0.2, реализован в schemas.py и API на ветке api (mock STT/агенты); фактический статус и «Не реализовано» — в разделе «Статус реализации v0.2». Целевые разделы CONTRACT не считать реализованным кодом.
- Неизвестные даты/имена остаются null/помеченными. Последняя согласованная правка срока, не механически последняя фраза. Assignee может не говорить и быть отделом.
- Raw transcript неизменяем, цитаты/таймкоды проверяемые, edits и approved snapshot отдельно. confidence=null до калибровки; mock не выдавать за real.
- Перед изменением более двух файлов — короткий план. Небольшие коммиты, только после проверки; не коммитить без необходимости.
- Для реализации: готово = релевантные тесты проходят + демо-путь работает + статус. Для planning-only: сверка документов/JSON и запись статуса, без изменения product code; commit/push документации допустим по запросу пользователя. Не выполнять автоматический git add -A на смешанном рабочем дереве с исходными записями.
- Никогда не коммить .env, *.db, реальные персональные данные и реальные записи совещаний.
