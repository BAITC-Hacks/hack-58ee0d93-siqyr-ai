# Backend handoff — Nurdaulet и Alibi

Текущий контракт: `docs/CONTRACT.md` и `backend/shared/schemas.py` (v0.1, без изменения общих типов). Данные ниже синтетические; запись и транскрибация участников объявлены в первой реплике.

## Nurdaulet: mock API уже работает

Все запросы `/api`, кроме `/api/health` и входа, содержат `Authorization: Bearer <access_token>`. `POST /api/auth/login` принимает `{ "username": "...", "password": "..." }`. Для разработки выставить `AGENT_MODE=mock`, `STT_MODE=mock` и получить список через `GET /api/samples`.

Создать запуск: `POST /api/runs` с `multipart/form-data`: `sample=demo`, `meeting_date=2026-09-23`, `lang=rukk`, `department_id=default` (или вместо `sample` поле `file` с аудио). Ответ `201 {"run_id":"<id>","status":"queued"}`.

`GET /api/runs/<id>` возвращает `run.status`, `steps`, `proposal`, `result`, `files`. Статусы: `queued → transcribing → running → awaiting_approval → executing → done`; возможны `rejected`, `error`. `GET /api/runs/<id>/events` — SSE через `fetch` с Bearer: `event: step` (`id` = `seq`, `data` = `StepEvent`) и `event: status` (`data` = `{"status":"..."}`). При восстановлении соединения передать `Last-Event-ID`.

Пример `proposal` при `awaiting_approval` (показаны 2 из 10 сегментов и 1 из 4 поручений):

```json
{
  "run_id": "<id>",
  "summary": "Обсудили запуск портала обращений и сроки работ.",
  "decisions": ["Следующее совещание — 2026-09-30"],
  "speakers": {"SPEAKER_00": "Айгерим Тестова", "SPEAKER_01": "Ерлан Демов"},
  "segments": [
    {"start": 0.0, "end": 7.2, "speaker": "SPEAKER_00", "lang": "ru", "text": "всем добрый день коллеги сегодня обсуждаем запуск портала обращений напоминаю что ведётся запись и транскрибация"},
    {"start": 7.6, "end": 13.9, "speaker": "SPEAKER_00", "lang": "rukk", "text": "ерлан сен сентябрь айындағы обращения бойынша отчётты жұмаға дейін дайындап жібер"}
  ],
  "assignments": [
    {"assignee": "Ерлан Демов", "task": "Подготовить и отправить отчёт по обращениям за сентябрь", "deadline": "2026-09-25", "deadline_text": "жұмаға дейін", "priority": "normal", "category": null, "source_segments": [1, 2]}
  ]
}
```

`source_segments` — индексы в полном массиве `proposal.segments` (если пуст, в сохранённом `run.segments`). Подсветка источника: взять сегмент по индексу и перейти к `start` в аудио. Сохранение правок и утверждение одним запросом: `POST /api/runs/<id>/approve` с `{ "approved": true, "proposal": <полный отредактированный Proposal>, "comment": "Проверено" }`; ответ `{ "status": "executing" }`. Итог: `run.status=done`, `proposal` — утверждённая версия, `result.excerpts` — выдержки, `GET /api/assignments?run_id=<id>` — поручения.

Предлагаю один экспортный путь: существующий клиентский экспорт **утверждённого** `proposal` после `done`; серверные `files.docx/pdf` уже доступны как запасной вариант. Подтвердите выбор. Для воспроизведения загруженной записи нужен новый защищённый `GET /api/runs/<id>/audio` с поддержкой Range; подтвердите, что frontend будет использовать этот URL через авторизованный `fetch`/blob. До согласования маршрут в общий контракт не добавлен.

## Alibi: подключение модулей

Текущая точка STT: `backend/stt/engine.py` экспортирует синхронную `transcribe(audio_path: Path, lang: str = "rukk") -> list[Segment]`; backend вызывает через `asyncio.to_thread`. `Segment` содержит `start`, `end` в секундах, `speaker`, `text`, необязательный `lang`. Текущая точка агентов: `backend/agents/runner.py` экспортирует `async propose(run_input: RunInput, emit: Emit) -> Proposal` и `async execute(proposal: Proposal, emit: Emit) -> Result`. `RunInput.segments` — уже готовый транскрипт; `emit(StepEvent)` сохраняет шаг, присваивает `seq` и шлёт SSE. `needs_approval` и `final` выпускает backend. `AssignmentDraft.source_segments` содержит индексы сегментов, например `[1, 2]` для поручения Ерлану выше. Реальные встречи используют только локальные STT и LLM через явно заданный `LLM_BASE_URL`; облачного fallback нет. Подтвердите этот интерфейс или укажите конкретные несовместимости до изменения `backend/shared/schemas.py`.
