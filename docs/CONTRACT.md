# CONTRACT — Meiirlan владеет файлом

Меняется только по согласию затронутых, с записью в docs/DECISIONS.md. Типы — backend/shared/schemas.py.

## Поток
```
upload / sample ─► STT + диаризация ─► propose() ─► awaiting_approval ─► approve ─► execute() ─► экспорт + поручения ─► done
                   backend/stt         agents        секретарь правит            agents       backend
```
Статусы запуска: `queued → transcribing → running → awaiting_approval → executing → done | rejected | error`

## HTTP (frontend ↔ backend)

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
