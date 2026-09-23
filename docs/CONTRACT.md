# CONTRACT — Meiirlan владеет файлом

Меняется только по согласию затронутых, с записью в docs/DECISIONS.md. Типы — backend/shared/schemas.py.

## Поток
```
upload / sample ─► STT + диаризация ─► propose() ─► awaiting_approval ─► approve ─► execute() ─► экспорт + поручения ─► done
                   backend/stt         agents        секретарь правит            agents       backend
```
Статусы запуска: `queued → transcribing → running → awaiting_approval → executing → done | rejected | error`

## HTTP (frontend ↔ backend)

### Авторизация и департаменты

- Все маршруты `/api`, кроме `/api/health`, `/api/auth/login`, `/api/auth/ecp/challenge`, `/api/auth/ecp/verify`, требуют `Authorization: Bearer <access_token>`; без токена — 401. `/api/samples` тоже требует токен.
- `POST /api/auth/login` принимает `{username, password}` и отдаёт `{access_token, token_type: "bearer", expires_in, user}`. `GET /api/auth/me` отдаёт `{id, username, display_name, is_system_admin, departments: {department_id: role}}`.
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
