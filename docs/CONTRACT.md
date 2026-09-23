# CONTRACT — Meiirlan владеет файлом

Это план контракта v0.2 на базе существующего v0.1. Пользователь запросил его составление; продуктовый код не менялся. Meiirlan переносит согласованные с Alibi дополнения в backend/shared/schemas.py первой задачей. До этого schemas.py содержит только v0.1. Ниже сохраняются пути и сигнатуры каркаса; уточнения v0.2 и JSON Schema в конце имеют приоритет для реализации. Изменения перечислены явно в DECISIONS.md.

**Согласование перед реализацией:** это проект, не уже согласованный transport contract. Сверить текущие ветки всех участников и один fixture. В main 7bae7c2 frontend уже имеет клиентский DOCX/печать PDF; COORDINATION.md предлагает переиспользовать их с server approved snapshot. Это решение ещё требует ACK Meiirlan/Nurdaulet; перечисленные ниже серверные file endpoints описывают прежний вариант и не поручаются второму участнику параллельно. После выбора владелец обновит routes, files/final payload и export-stage вместе; схема данных здесь не меняется.

## Поток
```
upload / sample ─► STT + диаризация ─► propose() ─► awaiting_approval ─► approve ─► execute() ─► экспорт + поручения ─► done
                   backend/stt         agents        секретарь правит            agents       backend
```
Статусы запуска: `queued → transcribing → running → awaiting_approval → executing → done | rejected | error`

## HTTP (frontend ↔ backend)

### Авторизация и департаменты

- **Демо: `AUTH_MODE=disabled` (по умолчанию).** Токен не нужен, все маршруты доступны от демо-администратора, SSE читается обычным `EventSource`. `GET /api/health` отдаёт `auth_mode`, фронт показывает плашку «демо без входа». Правила ниже действуют при `AUTH_MODE=local|keycloak|hybrid`.
- Все маршруты `/api`, кроме `/api/health`, `/api/auth/login`, `/api/auth/ecp/challenge`, `/api/auth/ecp/verify`, требуют `Authorization: Bearer <access_token>`; без токена — 401. `/api/samples` тоже требует токен.
- `POST /api/auth/login` принимает `{username, password}` и отдаёт `{access_token, token_type: "bearer", expires_in, user}`. `GET /api/auth/me` отдаёт `{id, username, display_name, is_system_admin, departments: {department_id: role}}`.
- `GET /api/profile` возвращает `{id, username, display_name, is_system_admin, departments: [{id, organization_id, name, parent_id, role}], settings: {language, theme, notifications_enabled}, avatar_url, updated_at}`. `PATCH /api/profile` принимает любой набор `{display_name?, language?: "ru"|"kk"|"en", theme?: "system"|"light"|"dark", notifications_enabled?: bool}` и возвращает обновлённый профиль.
- `POST /api/profile/password` принимает `{current_password, new_password}` (только local/hybrid с локальным паролем) и возвращает новый `{access_token, token_type, expires_in}`; ранее выданные локальные JWT этого пользователя отзываются. В `keycloak` пароль меняется на стороне IdP.
- `PUT /api/profile/avatar` принимает multipart `file` (JPEG, PNG, WebP, максимум 2 МБ) и возвращает `{avatar_url, content_type}`. Изображение пересохраняется как WebP 256×256 без исходных метаданных. `GET /api/profile/avatar` возвращает только аватар владельца; `DELETE /api/profile/avatar` удаляет его (204). В `AUTH_MODE=disabled` профиль можно читать, изменения запрещены.
- При `AUTH_MODE=keycloak|hybrid` тот же заголовок принимает подписанный RS256 access token Keycloak с настроенными `iss` и `aud`. `sub` должен быть заранее привязан к локальному пользователю через `POST /api/admin/identities`; роли берутся только из локальных membership. `hybrid` также принимает локальные токены; `keycloak` выключает вход по паролю.
- `GET /api/departments` возвращает только доступные подразделения `{id, organization_id, name, parent_id}`.
- `POST /api/runs` дополнительно принимает `department_id` (по умолчанию `default`); `Run` в ответах содержит `department_id`. Списки совещаний, поручений, уведомлений фильтруются по доступным департаментам. Для недоступного совещания и его экспорта — 404; для запрещённого действия в доступном департаменте — 403.
- Роли: `viewer` читает; `editor` также создаёт совещания и меняет поручения; `secretary` также утверждает протокол; `department_admin` имеет все действия в своём департаменте; `is_system_admin` имеет доступ ко всем департаментам и запускает общую проверку напоминаний.
- Системный администратор создаёт департаменты через `POST /api/admin/departments` `{id, name, organization_id?, parent_id?}`, пользователей через `POST /api/admin/users` `{username, display_name, password?, is_system_admin?}`, назначает роль через `POST /api/admin/memberships` `{user_id, department_id, role}` и привязывает внешний идентификатор через `POST /api/admin/identities` `{user_id, provider: "keycloak"|"ecp", subject}`.
- `PATCH /api/admin/users/{id}` с `{active?, password?}` отключает/включает пользователя или меняет его пароль. Отключение немедленно делает ранее выданный JWT непригодным.
- `POST /api/auth/ecp/challenge` возвращает `{challenge_id, data_base64, expires_at}`; клиент подписывает именно `data_base64` через NCALayer. `POST /api/auth/ecp/verify` принимает `{challenge_id, cms}`. Backend запрашивает доверенный `ECP_VERIFY_URL`; проверяющий сервис обязан подтвердить CMS, цепочку/срок сертификата, отзыв и точное совпадение исходного payload. Только после этого выдаётся одноразовый локальный JWT для заранее привязанного `ecp` subject. Без сервиса — 503.
- Нативный браузерный `EventSource` не умеет добавлять заголовок Bearer; фронтенд читает SSE через `fetch` с Authorization и разбирает те же `event/id/data`.

| Метод | Путь | Вход | Выход |
|---|---|---|---|
| GET | `/api/health` | — | `{status, agent_mode, stt_mode, demo_mode, llm, today}` |
| GET | `/api/samples` | — | `[{id, title, description, lang, synthetic, participants}]` — пресеты для демо |
| POST | `/api/runs` | multipart: `file` (аудио/видео) **или** `sample` (`demo`); `title`, `meeting_date` (YYYY-MM-DD), `lang` (`rukk`\|`kk`\|`ru`), `participants` (JSON-массив или имена через запятую) | `201 {run_id, status}` |
| GET | `/api/runs` | — | список запусков `{id, title, meeting_date, status, synthetic, assignments_count, created_at}` |
| GET | `/api/runs/{id}` | — | `{run, steps: StepEvent[], proposal, result, files: {docx, pdf}}` |
| GET | `/api/runs/{id}/events` | заголовок `Last-Event-ID` (опц.) | SSE, см. ниже |
| POST | `/api/runs/{id}/approve` | `{approved: bool, comment?: str, proposal?: Proposal}` — секретарь может прислать отредактированный черновик | `{status}` |
| GET | `/api/runs/{id}/protocol.docx` | — | файл |
| GET | `/api/runs/{id}/protocol.pdf` | — | файл |
| GET | `/api/assignments` | `?status=in_progress\|overdue\|done&assignee=&run_id=` | `[{id, run_id, run_title, assignee, task, deadline, deadline_text, priority, category, status, days_left}]` |
| PATCH | `/api/assignments/{id}` | `{done: bool}` | поручение |
| GET | `/api/notifications` | `?recipient=` | `[{id, kind: excerpt\|due_soon\|overdue, recipient, message, assignment_id, created_at}]` |
| POST | `/api/reminders/run` | — | `{created, today}` — ручной запуск проверки сроков (сценарий 2) |

MVP реализует health, samples, POST/GET runs, GET run, events, approve и оба protocol-файла. Остальные assignments/notifications/reminders маршруты — отложенные, UI их не вызывает до реализации. Добавления v0.2: GET `/api/runs/{id}/audio` для исходного аудио с Range; PUT `/api/runs/{id}/proposal` для сохранения проверяемого черновика с `{expected_revision, proposal}`.

### Статус реализации v0.2 (ветка api, Meiirlan, 14:46)

Реализовано и покрыто тестами (`tests/test_contract_v02.py`, mock STT/агенты):
- `backend/shared/schemas.py` v0.2 **только добавлением полей с умолчаниями**: ответы v0.1 остаются валидными. Segment: `speaker` nullable, `speaker_candidates`, `corrected_text`, `review_reasons`. Participant: `kind`, `present`. RunInput: `meeting_date` nullable, `meeting_date_verified`. AssignmentDraft: `assignee` nullable, `deadline_candidates`, `evidence[]`, `review_status`, `review_reasons`, `review_note`, `confidence=null`. Proposal: `revision`, `source_mode`, `speaker_records`. Новые типы `Evidence`, `Speaker`.
- `PUT /api/runs/{id}/proposal` `{expected_revision, proposal}` → `{revision, proposal}`. Только `awaiting_approval`; чужая revision → 409; ссылка на несуществующую реплику, цитата не из реплики, изменение числа реплик → 422. `text/start/end` реплик всегда берутся из сырого транскрипта; правка человека — только `corrected_text`/`speaker`.
- `POST /api/runs/{id}/approve` принимает `expected_revision` (рекомендуется). Ответ `{status, revision}`. Повтор той же revision в executing/done → 200 тот же результат; другая → 409. Утверждение сохраняет immutable `approved` snapshot; execute, реестр поручений и DOCX/PDF строятся только из него. `review_status=excluded` не попадает в реестр и файлы.
- Блокирующие причины (`deadline_conflict`, `evidence_missing`, `speaker_uncertain`, `overlap`, `audio_protocol_mismatch`) у `unreviewed` поручения → approve 409 `{detail, code: "review_required", assignments: [номера]}`. `owner_uncertain`/`deadline_unknown` не блокируют: утверждение протокола подтверждает «не указан». Остальные `unreviewed` при approve становятся `confirmed`.
- Сервер проверяет вывод модели: несуществующие индексы и непроверяемые цитаты удаляются с причиной `evidence_missing`; `start/end` evidence берутся из сегмента; при отсутствии цитат evidence = целая реплика из `source_segments`. `revision=1` и `source_mode` задаёт сервер (раннер не может объявить mock реальным).
- Дата совещания не подставляется: без `meeting_date` у загрузки → `meeting_date=null`, `meeting_date_verified=false`, абсолютная дата срока удаляется, причина `deadline_unknown`. Для `sample=demo` берётся дата сценария fixture.
- `GET /api/runs/{id}/audio` — исходный файл с Range (206), 404 если записи нет (sample). В режиме с авторизацией `<audio src>` не шлёт Bearer: фронту нужен fetch→blob.
- GET run дополнительно: `revision`, `approved`, `approved_at`, `transcript {source_mode, segments}` (сырой), `audio`. Run view: `meeting_date_verified`, `source_mode`.
- SSE `data.stage`: `transcribe`, `validate`, `review` (needs_approval и каждое сохранение), `approve`, `export`, `complete`; `duration_ms` у transcribe/validate/export. Этапы внутри раннера (`map_speakers`, `extract`, `summarize`) проставляет раннер Alibi.
- `LLM_PROVIDER=local|dev_openai` (по умолчанию local, `MODEL_MAIN=qwen3:4b`, `MODEL_FAST=qwen3:1.7b`). local с адресом OpenAI и dev_openai с несинтетическим запуском останавливают real-run. `/api/health` отдаёт `llm_provider`, `llm_model`.

Не реализовано: audit log с автором правки отдельной таблицей (сейчас шаг SSE `stage=review` с `user_id`), speaker mapping как отдельный маршрут (правится через `speakers`/`speaker_records` в PUT), 429 при занятом worker, 503 при отсутствии модели, `usage_available`.

Ошибки: `{detail: "текст для пользователя"}`. 400 — неверный ввод, 404 — нет запуска, 409 — не тот статус, 413 — файл больше MAX_UPLOAD_MB, 415 — формат, 429 — rate limit.

### SSE `/api/runs/{id}/events`
- Сначала отдаются уже сохранённые шаги, затем новые в реальном времени.
- `event: step`, `id: <seq>`, `data: StepEvent (JSON)`
- `event: status`, `data: {"status": "<RunStatus>"}`
- Heartbeat: комментарий `: ping` каждые 15 с.
- На `done` / `rejected` / `error` сервер закрывает поток. Клиент тоже вызывает `EventSource.close()`, иначе браузер переподключится.

## StepEvent
```
{run_id, seq, type, agent, content, data, tokens, cost_usd, ts}
type: agent_start | tool_call | tool_result | handoff | needs_approval | final | error
```
- `agent`: `stt`, `orchestrator`, `speaker_mapper`, `assignment_extractor`, `summarizer`, `notifier`, `secretary`.
- `handoff`: `data.to` — кому передана работа.
- `needs_approval`: `data.proposal` — черновик протокола. Эмитит бэкенд.
- `final`: `data.docx`, `data.pdf`, `data.assignments`. Эмитит бэкенд.
- `content` — одна строка по-русски для карточки трейса.

## Python (backend ↔ agents), backend/agents/runner.py и runner_mock.py
```python
async def propose(run_input: RunInput, emit: Emit) -> Proposal
async def execute(proposal: Proposal, emit: Emit) -> Result
```
- `emit(StepEvent)` даёт бэкенд: сохраняет шаг в SQLite, проставляет `seq`, пушит в SSE.
- `propose()` получает готовый транскрипт; `execute()` готовит выдержки для ответственных (`Result.excerpts`).
- Экспорт DOCX/PDF, запись поручений в БД и напоминания делает бэкенд после `execute()`.
- `AGENT_MODE=mock` → runner_mock.py с теми же функциями.

## Python (backend ↔ stt), backend/stt
```python
def transcribe(audio_path: Path, lang: str = "rukk") -> list[Segment]
```
- Синхронная, бэкенд вызывает через `asyncio.to_thread`.
- `Segment = {start, end, speaker: "SPEAKER_00", text, lang?}`; текст в нижнем регистре, без пунктуации.
- `STT_MODE=mock` → сегменты из data/seed/demo_meeting.json.

## Типы (backend/shared/schemas.py)
`Segment`, `Participant`, `RunInput`, `AssignmentDraft`, `Proposal`, `Excerpt`, `Result`, `StepEvent`, `Emit`.

## Проверка расхождений с кодом и минимальная миграция

| Место v0.1 | Проблема | Изменение v0.2 и владелец |
|---|---|---|
| Segment.speaker обязателен | При overlap/сбое нельзя честно выбрать один голос | Nullable speaker, speaker_candidates/review_reasons; Meiirlan + Alibi. |
| RunInput.meeting_date всегда date | Истинная дата старых записей неизвестна | Nullable meeting_date и meeting_date_verified; не подставлять сегодняшнюю дату для нормализации. |
| Participant содержит только name/role | Внешний исполнитель/отдел могут не выступать | kind person/department, present boolean, name остаётся ключом для MVP. |
| AssignmentDraft без evidence/review | Нельзя подтвердить цитату, конфликт или полноту | Дополнительные evidence, review_reasons, review_status, confidence=null; assignee nullable. |
| Proposal без revision | Два утверждения/устаревшая правка расходятся | revision, source_mode, speaker_records, review_status; optimistic check на save/approve. |
| Proposal.segments может быть «очищенным» | Цитата теряет связь с raw текстом | Raw transcript неизменяем; Segment.text исходный, corrected_text отдельно. Индексы не переставлять. |
| В коде нет Transcript/Speaker/Poruchenie/Protocol | Названия из задания ещё не определены | Transcript/Speaker новые; Poruchenie — доменное имя AssignmentDraft, Protocol — Proposal+метаданные, без дублирования классов. |
| health: llm=local если любой base_url | Туннель или external endpoint ошибочно названы local | Выводить provider и location явно, не угадывать по наличию строки. |
| config.py: пустой base_url → OpenAI | Возможна неявная отправка данных | Local profile fail closed; dev_openai только для проверенного synthetic manifest. |

## Семантика запросов и утверждения

- POST runs: ровно file или sample; принимаем MP3/WAV до 100 MB и 10 минут. lang — пожелание пользователя, не доказательство языка. meeting_date обязателен для нового демо, но исходные файлы без известной даты помечаются `meeting_date_verified=false`: нормализация относительных сроков отключена. Не подставлять сегодняшнюю дату молча.
- participants принимаем JSON-массив Participant; строковый список каркаса можно поддержать как удобный ввод. Не определяет число акустических голосов автоматически: присутствующий может молчать.
- POST возвращает 201 после сохранения, обработка идёт в background, один worker. Полная очередь → 429. Синхронный STT через thread/process вне event loop. Отмена/перезапуск не обязательны в MVP.
- GET run возвращает raw Transcript, proposal, result, шаги, ревизию, source_mode и ссылки. Raw аудио и транскрипт сохраняются отдельно от правок. Files до done — null.
- PUT proposal допускается только awaiting_approval; ожидаемая revision обязательна, mismatch → 409. Проверка ссылок/полей → 422. Сервер увеличивает revision; UI обновляет её.
- POST approve дополняется expected_revision. approved=false → rejected. approved=true разрешён только после явной проверки всех критических конфликтов и speaker mapping, которые используются в поручениях; нет необходимости выдумывать неизвестного ответственного. Подтверждённое «не указан» допустимо.
- Approve сохраняет immutable snapshot перед execute; exports строятся только из него. Повтор того же approve в executing/done возвращает тот же результат; другая revision → 409. После done редактирование запрещено в MVP.
- execute не вызывает LLM повторно и не меняет одобренные поля; только детерминированные excerpts/подготовка результата. Экспорт делает backend. Внешней рассылки нет.
- Истёкший timeout/битый JSON → один schema repair максимум, затем error с сохранённым transcript. Нельзя отдавать success с пустой подменой.
- 400 ввод; 404 ID; 409 состояние/revision; 413 объём; 415 формат; 422 схема; 429 очередь; 503 модель отсутствует. Ошибка содержит detail и необязательный code, без secrets/полного prompt.

## StepEvent v0.2 без смены существующих event types

Сохраняем `agent_start | tool_call | tool_result | handoff | needs_approval | final | error`. Не добавляем новый enum ради каждого этапа. В data добавляем stage/status/duration_ms. tokens и cost_usd — фактические счётчики либо 0 с пометкой `usage_available=false`; 0 для local API не означает бесплатное железо.

| data.stage | agent | Начало / результат | Что показать |
|---|---|---|---|
| ingest | orchestrator | tool_call / tool_result | Файл принят, проверены формат/длительность. |
| normalize_audio | stt | tool_call / tool_result | 16 kHz mono; исходная временная шкала. |
| vad | stt | tool_call / tool_result | Найдены интервалы речи. |
| diarize | stt | tool_call / tool_result | Число голосов, overlap, модель. |
| transcribe | stt | agent_start / tool_result | Готово N сегментов, длительность; без выдуманного процента. |
| map_speakers | speaker_mapper | agent_start / tool_result | Предлагаемая связь голосов с именами, ещё не подтверждена. |
| extract | assignment_extractor | agent_start / tool_result | Поручения и ссылки на источники. |
| summarize | summarizer | agent_start / tool_result | Саммари; если тот же LLM-вызов, data.shared_call_id одинаковый. |
| validate | orchestrator | tool_call / tool_result | Проверены schema, evidence, даты; причины review. |
| review | secretary | needs_approval | Черновик, revision, количество требующих проверки. |
| approve | secretary | tool_result | Одобрена конкретная revision либо status rejected. |
| export | orchestrator | tool_call / tool_result | DOCX/PDF создан для snapshot. |
| complete | orchestrator | final | Файлы доступны, status done. |

Любой stage может эмитить error с code и retryable. seq монотонный в пределах run, назначается сервером; data никогда не содержит chain-of-thought или ключи. SSE replay возвращает только seq > Last-Event-ID. UI дедуплицирует seq, после reload берёт snapshot; awaiting_approval не terminal, done/rejected/error terminal. Два обращения «extract/summarize» не выдаём за два независимых агента, если выполнен один вызов.

## JSON Schema v0.2

Draft 2020-12. Шесть доменных сущностей и вспомогательная Evidence определены ниже; корень — Protocol. Эти определения — проект для Pydantic и UI, а не уже сгенерированные кодом схемы. LLM отдаёт только содержимое proposal; run_id, revision, timestamps и источник режима задаёт сервер. Схему для structured output можно упростить до поддержанного subset, затем проверить полной схемой на backend.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$ref": "#/$defs/Protocol",
  "$defs": {
    "Segment": {
      "type": "object", "additionalProperties": false,
      "required": ["start", "end", "speaker", "text"],
      "properties": {
        "start": {"type": "number", "minimum": 0},
        "end": {"type": "number", "exclusiveMinimum": 0},
        "speaker": {"type": ["string", "null"]},
        "speaker_candidates": {"type": "array", "items": {"type": "string"}},
        "text": {"type": "string"},
        "corrected_text": {"type": ["string", "null"]},
        "lang": {"enum": ["ru", "kk", "rukk", null]},
        "review_reasons": {"type": "array", "items": {"type": "string"}}
      }
    },
    "Participant": {
      "type": "object", "additionalProperties": false,
      "required": ["name"],
      "properties": {
        "name": {"type": "string", "minLength": 1},
        "role": {"type": ["string", "null"]},
        "kind": {"enum": ["person", "department"]},
        "present": {"type": "boolean"}
      }
    },
    "Speaker": {
      "type": "object", "additionalProperties": false,
      "required": ["label", "participant_name", "mapping_status", "source_segments"],
      "properties": {
        "label": {"type": "string", "pattern": "^SPEAKER_[0-9]+$"},
        "participant_name": {"type": ["string", "null"]},
        "mapping_status": {"enum": ["unmapped", "suggested", "confirmed"]},
        "source_segments": {"type": "array", "items": {"type": "integer", "minimum": 0}}
      }
    },
    "Transcript": {
      "type": "object", "additionalProperties": false,
      "required": ["run_id", "audio_sha256", "duration_seconds", "lang", "source_mode", "segments", "speakers"],
      "properties": {
        "run_id": {"type": "string"},
        "audio_sha256": {"type": ["string", "null"]},
        "duration_seconds": {"type": "number", "minimum": 0},
        "lang": {"enum": ["ru", "kk", "rukk"]},
        "source_mode": {"enum": ["real", "mock", "replay"]},
        "segments": {"type": "array", "items": {"$ref": "#/$defs/Segment"}},
        "speakers": {"type": "array", "items": {"$ref": "#/$defs/Speaker"}}
      }
    },
    "Evidence": {
      "type": "object", "additionalProperties": false,
      "required": ["segment_index", "quote", "start", "end", "field", "kind"],
      "properties": {
        "segment_index": {"type": "integer", "minimum": 0},
        "quote": {"type": "string", "minLength": 1},
        "start": {"type": "number", "minimum": 0},
        "end": {"type": "number", "exclusiveMinimum": 0},
        "field": {"enum": ["task", "assignee", "deadline", "context"]},
        "kind": {"enum": ["raw_transcript", "human_audio_correction"]}
      }
    },
    "Poruchenie": {
      "type": "object", "additionalProperties": false,
      "required": ["assignee", "task", "deadline", "deadline_text", "source_segments", "evidence", "review_status", "review_reasons", "confidence"],
      "properties": {
        "assignee": {"type": ["string", "null"]},
        "task": {"type": "string", "minLength": 1},
        "deadline": {"type": ["string", "null"], "format": "date"},
        "deadline_text": {"type": ["string", "null"]},
        "deadline_candidates": {"type": "array", "items": {"type": "string"}},
        "priority": {"enum": ["high", "normal", "low"]},
        "category": {"type": ["string", "null"]},
        "source_segments": {"type": "array", "minItems": 1, "uniqueItems": true, "items": {"type": "integer", "minimum": 0}},
        "evidence": {"type": "array", "minItems": 1, "items": {"$ref": "#/$defs/Evidence"}},
        "review_status": {"enum": ["unreviewed", "confirmed", "corrected", "excluded"]},
        "review_reasons": {"type": "array", "items": {"enum": ["owner_uncertain", "deadline_conflict", "deadline_unknown", "location_uncertain", "scope_incomplete", "speaker_uncertain", "overlap", "evidence_missing", "audio_protocol_mismatch"]}},
        "review_note": {"type": ["string", "null"]},
        "confidence": {"type": "null", "description": "Нет калиброванной вероятности; показывать review_reasons"}
      }
    },
    "Protocol": {
      "type": "object", "additionalProperties": false,
      "required": ["run_id", "title", "meeting_date", "meeting_date_verified", "revision", "status", "source_mode", "participants", "summary", "decisions", "speakers", "speaker_records", "segments", "assignments", "approved_at"],
      "properties": {
        "run_id": {"type": "string"},
        "title": {"type": "string"},
        "meeting_date": {"type": ["string", "null"], "format": "date"},
        "meeting_date_verified": {"type": "boolean"},
        "revision": {"type": "integer", "minimum": 1},
        "status": {"enum": ["draft", "approved", "rejected"]},
        "source_mode": {"enum": ["real", "mock", "replay"]},
        "participants": {"type": "array", "items": {"$ref": "#/$defs/Participant"}},
        "summary": {"type": "string"},
        "decisions": {"type": "array", "items": {"type": "string"}},
        "speakers": {"type": "object", "additionalProperties": {"type": "string"}},
        "speaker_records": {"type": "array", "items": {"$ref": "#/$defs/Speaker"}},
        "segments": {"type": "array", "items": {"$ref": "#/$defs/Segment"}},
        "assignments": {"type": "array", "items": {"$ref": "#/$defs/Poruchenie"}},
        "approved_at": {"type": ["string", "null"], "format": "date-time"}
      }
    }
  }
}
```

## Проверки сверх JSON Schema

1. `0 <= start < end <= duration`, индексы evidence/source_segments существуют; source_indices относятся к неизменяемому raw Transcript, а не к списку после сортировки UI. Для clip хранить source_offset; UI показывает секунды оригинала.
2. `quote` — подстрока указанного raw сегмента; punctuation/whitespace normalization разрешена одинаково для обеих сторон. Human correction хранится отдельно с именем проверившего/временем в audit log и не маскируется как STT.
3. Evidence time берётся из сегмента сервером. LLM не изобретает точные таймкоды слов. Несколько соседних источников допустимы для одного поручения.
4. Срок «через две недели» вычислять только от подтверждённой даты. «На следующей неделе» хранить как диапазон/текст, deadline=null, если конкретный день не назван. «После совещания» — событие, не дата. День/месяц без года при неизвестной дате → null.
5. Последняя **явно согласованная** правка того же поручения заменяет старую; поздний пересказ без ясности не отменяет прошлое автоматически. Сохраняем обе цитаты; конфликтующие сроки идут на аудио-проверку.
6. Assignee не обязан быть говорящим: можно добавить внешнего исполнителя/отдел в participants с present=false. Уникальность имён проверять; неизвестное имя не подменять ближайшим без review.
7. Несколько формулировок одного поручения объединять только по смыслу и исполнителю, сохраняя evidence; не удваивать задачи из финального recap. Инструкции внутри транскрипта являются данными, не командами модели/сервера.
8. Approval требует reviewed для всех не excluded задач. Неизвестный срок/ответственный можно явно подтвердить как неизвестный; unresolved конфликт двух значений — нельзя. Изменение поля сохраняется в audit и инвалидирует прежнее утверждение до done.
9. Summary может описывать проблему из transcript, но не добавлять скрытые факты из DOCX. После ручной правки поручений итоговое саммари просматривает человек; не выполнять скрытую регенерацию после approval.
