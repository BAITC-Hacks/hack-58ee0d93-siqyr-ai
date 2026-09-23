# Backend handoff — Nurdaulet и Alibi

[15:05] Текущий контракт: `docs/CONTRACT.md` v0.2, реализован в `backend/shared/schemas.py` и API на ветке `api` (cc4d99b). Полный список маршрутов, ошибок и «Не реализовано» — в CONTRACT, раздел «Статус реализации v0.2». Готовые сообщения коллегам — `docs/handoffs/meiirlan.md`. Данные ниже синтетические; запись и транскрибация участников объявлены в первой реплике.

## Nurdaulet: API на mock уже работает

- Запуск: `bash scripts/run_local.sh --api-only` → `http://127.0.0.1:8000`. По умолчанию `AUTH_MODE=disabled`, `STT_MODE=mock`, `AGENT_MODE=mock`: токен не нужен, SSE читается обычным `EventSource`, `<audio src>` работает напрямую. CORS открыт для `http://localhost:5174` и `http://127.0.0.1:5174`.
- `GET /api/health` → режимы, `ready`, `problems`. Показывать плашку mock/real по `source_mode` запуска, не по health.
- Создать запуск: `POST /api/runs`, `multipart/form-data`: `sample=demo` **или** `file`; `title`, `meeting_date` (YYYY-MM-DD, для нового демо передавать), `lang=rukk|kk|ru`, `participants` (JSON-массив или имена через запятую). Ответ `201 {"run_id","status":"queued"}`; 503 — модели real-режима не готовы (текст причины в `detail`); 429 — очередь полна.
- Ход обработки: `GET /api/runs/<id>/events` — `event: step` (`id`=`seq`, `data`=StepEvent с `data.stage`) и `event: status`. Статусы: `queued → transcribing → running → awaiting_approval → executing → done`; также `rejected`, `error`. При переподключении — `Last-Event-ID`.
- Черновик: `GET /api/runs/<id>` → `proposal` (с `revision`), `transcript.segments` (сырой текст), `audio` (URL с Range: `currentTime = evidence[].start`), `source_mode` (`real|mock|replay`). Поручение: `assignee` может быть `null` («не указан»), `evidence[]{segment_index, quote, start, end}`, `review_reasons` (словами), `review_status: unreviewed|confirmed|corrected|excluded`, `confidence` всегда `null`.
- Сохранить правку: `PUT /api/runs/<id>/proposal` `{expected_revision, proposal}` → `{revision, proposal}`. 409 — кто-то сохранил раньше (перечитать run), 422 — ссылка/цитата не из транскрипта. Текст реплик не редактируется: только `corrected_text`/`speaker`.
- Утвердить: `POST /api/runs/<id>/approve` `{approved: true, expected_revision, comment?}` → `{status, revision}`. 409 `code=review_required` → в `assignments` номера поручений, которым нужно решение (подтвердить, исправить или `excluded`). `approved: false` → `rejected`.
- Итог после `done`: `files.docx` / `files.pdf` — серверные DOCX/PDF из утверждённой редакции (казахские буквы проверены); до `done` — `null` и 409. Реестр: `GET /api/assignments?run_id=<id>`, `PATCH /api/assignments/<id> {done}`; уведомления о сроках: `GET /api/notifications`.
- Экспорт: предлагаем один путь — серверные файлы. Если оставляешь клиентский DOCX, строй его только из `approved` в GET run после `done`. **Нужен ACK.**

Известная ошибка: утверждение поручения с `assignee=null` сейчас роняет запуск в `error` после approve (mock-раннер). Для демо пока указывайте ответственного или исключайте такое поручение; исправление — на стороне backend.

## Alibi: подключение модулей

- STT: `backend/stt/engine.py` экспортирует синхронную `transcribe(audio_path: Path, lang: str = "rukk") -> list[Segment]`; backend вызывает через `asyncio.to_thread`. Веса только из `settings.stt_model_dir` (`models/stt/asr/rukk`, `models/stt/vad/vad.onnx`) и `settings.diarization_model_dir` (`models/diarization`), без скачивания в рантайме. `Segment`: `start`, `end` (секунды исходной шкалы), `speaker` (или `null` при overlap), `text`, опц. `lang`, `speaker_candidates`, `review_reasons`.
- Агенты: `backend/agents/runner.py` экспортирует `async propose(run_input: RunInput, emit: Emit) -> Proposal` и `async execute(proposal: Proposal, emit: Emit) -> Result`. `RunInput.meeting_date` может быть `None` при `meeting_date_verified=false` — тогда `deadline=None`, `deadline_text` сохранить. В своих шагах ставь `data.stage = map_speakers | extract | summarize` и `duration_ms`. `needs_approval`/`final`, `revision`, `source_mode` и проверку evidence делает backend.
- `execute` получает утверждённый snapshot: пропускай `review_status=excluded` и не создавай `Excerpt` с `recipient=None` (у `assignee=null` — «Не указан»).
- LLM только через `backend/app/llm.py` (`await llm.complete(messages, model=..., response_format=...)`), `LLM_PROVIDER=local` по умолчанию; пустой `LLM_BASE_URL` или OpenAI для несинтетического запуска → 503/ошибка, облачного fallback нет.
- Проверка: `python scripts/preflight.py`; `bash scripts/demo_e2e.sh --file запись.wav --meeting-date 2026-09-23 --mode real`.
- **Нужно от Alibi:** ветка/SHA с `engine.py` и `runner.py` (в репозитории их пока нет), список зависимостей для `backend/requirements-stt.txt`, smoke-команда. ACK по полям или COUNTERPROPOSAL.
