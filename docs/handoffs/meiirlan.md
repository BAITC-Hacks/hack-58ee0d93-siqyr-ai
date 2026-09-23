# Handoff — Meiirlan (backend/API)

Файл обновляет только Meiirlan. Сообщения ниже переносятся в общий чат вручную; запись здесь не означает, что коллега их получил.

## 14:46 — READY для Alibi

```text
READY | Meiirlan | api@uncommitted; передано примером | contract=v0.2 (docs/CONTRACT.md, «Статус реализации v0.2»)
Готово: backend/shared/schemas.py v0.2 — только новые поля с умолчаниями, твой v0.1-код валиден без правок.
Сигнатуры не менялись:
  transcribe(audio_path: Path, lang: str = "rukk") -> list[Segment]      # backend/stt/engine.py, вызываю через asyncio.to_thread
  async propose(run_input: RunInput, emit: Emit) -> Proposal             # backend/agents/runner.py
  async execute(proposal: Proposal, emit: Emit) -> Result
Новое во входе: RunInput.meeting_date может быть None, RunInput.meeting_date_verified=false → не нормализуй относительные сроки (deadline=None, deadline_text оставь).
Новое в выходе (всё опционально): Segment.speaker=None при overlap; AssignmentDraft.assignee=None, evidence=[{segment_index, quote, field}], deadline_candidates, review_reasons.
Сервер сам: проверяет, что quote — подстрока реплики (регистр/пунктуация игнорируются), ставит start/end из сегмента, при пустом evidence берёт реплики из source_segments, ставит revision=1 и source_mode. Непроверяемое → review_reasons=evidence_missing, не ошибка.
Этапы: я эмитю stage transcribe/validate/review/approve/export/complete; в своих emit добавляй data.stage = map_speakers | extract | summarize и duration_ms.
LLM: backend/app/llm.py → await llm.complete(messages, model=..., response_format=...) — kwargs уходят в chat.completions как есть. LLM_PROVIDER=local по умолчанию, MODEL_MAIN=qwen3:4b, MODEL_FAST=qwen3:1.7b; dev_openai только для synthetic run.
Правка в твоей зоне: backend/agents/runner_mock.py — при meeting_date=None срок не нормализуется (иначе падал upload без даты). Посмотри diff.
Проверено: pytest 46 passed, mock upload/sample → review → PUT → approve → DOCX/PDF.
Нужно от Alibi: ACK по полям или COUNTERPROPOSAL; ветка/SHA с backend/stt/engine.py и backend/agents/runner.py; ожидаемые зависимости (ffmpeg, torch, pyannote) и smoke-команда.
Не проверено: real STT, диаризация, local LLM.
```

## 14:46 — READY для Nurdaulet

```text
READY | Meiirlan | api@uncommitted; передано примером | contract=v0.2
API: http://127.0.0.1:8000, CORS для :5174 открыт, AUTH_MODE=disabled (токен не нужен, EventSource работает).
Поток: POST /api/runs (multipart: sample=demo | file; meeting_date, title, lang, participants) → SSE /api/runs/{id}/events → awaiting_approval →
  PUT /api/runs/{id}/proposal {expected_revision, proposal} → {revision, proposal}  (409 = кто-то сохранил раньше, 422 = ссылка/цитата не из транскрипта)
  POST /api/runs/{id}/approve {approved, expected_revision, comment?} → {status, revision}  (409 code=review_required → номера поручений в "assignments")
  → done → files.docx / files.pdf.
Для UI: GET run отдаёт revision, transcript.segments (сырой текст), audio (URL, Range работает — <audio src> + currentTime = evidence.start), source_mode (real|mock|replay — показывать плашкой).
Поручение: assignee может быть null («не указан»), evidence[].start/end — секунды для перехода плеера, review_reasons — причины проверки словами, review_status: unreviewed|confirmed|corrected|excluded. confidence всегда null.
Экспорт — предлагаю один путь: серверные DOCX/PDF из утверждённого snapshot (уже готовы, казахские буквы проверены). Если оставляешь свой клиентский DOCX — строй его только из `approved` в GET run после done.
Нужно от Nurdaulet: ACK по экспорту; SHA ветки, когда adapter будет готов к проверке одного пути.
```

## 14:57 — дополнение для Alibi

```text
READY | Meiirlan | api@cc4d99b | contract=v0.2
Веса: STT_MODE=real ищет models/stt/asr/rukk и models/stt/vad/vad.onnx, диаризацию — в models/diarization (settings.stt_model_dir / settings.diarization_model_dir; пути меняются через STT_MODEL_DIR / DIARIZATION_MODEL_DIR). engine.py грузит только отсюда, без hf download в рантайме.
Без весов/ffmpeg/torch API отвечает 503 до приёма файла, /api/health → ready=false + problems.
Установка: bash scripts/setup.sh --with-stt (torch CPU + requirements-stt + pyannote.audio 4.0.7), затем --download-models. Если нужны другие пакеты/версии — REQUEST_CHANGE, requirements-stt.txt твой.
Проверка: python scripts/preflight.py; bash scripts/demo_e2e.sh --file запись.wav --meeting-date 2026-09-23 --mode real.
Обработка идёт в одном worker: transcribe и propose не выполняются параллельно для двух совещаний.
```
