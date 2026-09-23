# Проверка готовности AI к синхронизации

## Freeze: AI готов к передаче бэкендеру — 2026-09-23

**READY для передачи AI-контракта v0.2 бэкендеру с обязательной ручной проверкой спорных результатов.** Зафиксированный код: `36352d86b30be305baf602c3f4be1c14496254ff`, поверх merge `6040eb0b39c385c7e2ed208a5eac60b33939343f`. Этот merge включает main `4a29f0aabcec3a36f104e77bd369825aa43f0a64`.

**Свежая проверка remote от root:** main продвинулся до `4c861c7022f8a93705e5e89fe0f2aab3b013c67f`; AI относительно него **ahead 18 / behind 3** (счёт подтверждён по локально обновлённым refs). Новые коммиты: `bab31ea` — frontend upload/API auth headers, `7450da0` — SMTP reminders, merge `4c861c7`. Они ещё не включены в проверенный AI-код. Последующую интеграцию с новым main выполняет бэкендер; тесты и smoke ниже относятся к AI 36352d8, а не к ещё не объединённому состоянию. Root публикует готовую AI-ветку для передачи; этот отчёт сам по себе не подтверждает завершение push или merge в main.

Eval-набор и результаты зафиксированы отдельным commit `9404d24` после кода `36352d8`; число ahead 18 выше относится именно к code commit. По финальной проверке root, read-only merge-tree нового main и текущей AI-ветки показал **0 маркеров конфликтов**. Это подтверждает отсутствие обнаруженных текстовых конфликтов, но совместный runtime нового frontend/SMTP и AI ещё должен проверить бэкендер.

Сигнатуры STT/propose/execute сохранены. Runner использует канонические Evidence и Speaker; дополнительные поля имеют defaults: `AssignmentDraft.assignee_candidates` и `Speaker.candidate_names/evidence/review_reasons/confidence`. Автоматические связи говорящих остаются suggested/unmapped, confidence=null. Execute детерминированный, без нового LLM-вызова.

### Проверки к передаче

- **165/165 pytest PASS** — финальный полный прогон root для этой версии. Проверяющий агент повторно тесты не запускал.
- Добавленные `tests/test_review_metadata.py` проверяют evidence/review/candidates/note через PUT → approve → approved snapshot → реестр → БД → повторное открытие, а также миграцию существующей таблицы без потери строк.
- Есть регрессии на пустую/частичную цитату, чужой голос, сохранение server review flags при пропуске или очистке клиентского списка, null/excluded в execute и обязательную ручную проверку scope_incomplete.
- API smoke root с настоящей Luna и встроенным полностью вымышленным STT-fixture завершён: **4 поручения → ручная RU/KK сверка формулировок сроков → approval → сохранение evidence → DOCX/PDF**. Run `e4e59fc2d257498f887f8d642782f548`, source_mode=mock, локальные результаты `/private/tmp/siqyr-main-sync-smoke`. Этот smoke подтверждает API-путь; качество распознавания аудио им не измерялось.

### Явное ограничение качества

Первый независимый текстовый baseline: **12/12 валидных Proposal**, строгая проверка **6/12**, ручная смысловая сверка тех же ответов **8/12**. После исправлений регрессионный повтор пяти случаев: **4/5 PASS**. Повтор не заменяет независимый baseline. Результаты описаны в `eval/ai_quality_v2/results_first_luna.md` и `eval/ai_quality_v2/results_regression_luna_5.md`.

Остаётся один mixed случай: действие `дайындау керек` не содержит объекта. Полный raw-контекст сохранён в evidence, выставлен `scope_incomplete`; сервер блокирует утверждение unreviewed поручения до явного подтверждения/исправления человеком. Сам автоматический текст действия остаётся неполным, этот случай **не засчитан как успешный**. Готовность к передаче означает работающий контракт и проверяемый ручной процесс; ручная проверка формулировок, исполнителей и сроков остаётся обязательной.

### Устранённые блокировки предыдущих проверок

| Предыдущее замечание | Состояние на freeze |
|---|---|
| Пять конфликтов при объединении main и AI | **RESOLVED** в merge 6040eb0 |
| Несовместимые SpeakerRecord/speaker/person_name/confirmed | **RESOLVED**: канонические Speaker(label, participant_name, mapping_status, source_segments), совместимые добавления |
| Проверенные evidence теряются в runner/реестре | **RESOLVED**: сохраняются в Proposal, approved и Assignment/API, покрыты round-trip тестом |
| Нет миграции новых metadata у существующей БД | **RESOLVED**: добавление колонок и тест сохранности старой строки |
| Execute падает на assignee=null или включает excluded | **RESOLVED**: пропускает неизвестного исполнителя и excluded, без LLM |
| Пустая после нормализации цитата и фрагмент слова проходят review | **RESOLVED**: отклоняются, есть отрицательные тесты |
| Обычный resave либо очищенный/пропущенный review_reasons снимает evidence_missing | **RESOLVED**: сервер сохраняет причины из текущего draft; явное исправление отделено от обычного save |
| Speaker evidence не проверяется по голосу/исходной цитате | **RESOLVED**: проверка принадлежности голосу и raw-цитаты |
| Новые AI/backend поля не имеют совместной проверки | **RESOLVED**: полный pytest 165/165 и API smoke завершены |

### Оставшиеся задачи frontend/backend интеграции

Новые frontend/SMTP изменения main 4c861c7 в этом проходе не проверялись. Эти задачи не блокируют передачу зафиксированного AI-модуля бэкендеру, но требуют проверки после объединения:

1. **Frontend adapter — старые сведения superseded:** утверждения ниже об отсутствии upload и auth headers основаны на main 4a29f0a. Новый bab31ea меняет именно эти участки; нельзя считать старые блокировки актуальными без повторной проверки. После интеграции проверить file → POST runs, получение proposal/raw/evidence/speaker_records, сохранение revision, review и approve.
2. **Экспорт и вход — требуется проверка нового main:** подтвердить использование server files/approved snapshot, работу AUTH_MODE=disabled и авторизованного API/SSE. Браузерный E2E на bab31ea/4c861c7 этим аудитом не выполнялся.
3. **Воспроизводимый запуск:** Python этого Mac 3.11.11 ниже preflight ≥3.12. Нужно согласовать среду запуска и проверить штатный setup/run на машине демо; это отдельная проверка упаковки.
4. **Документация владельца контракта:** внести совместимые дополнительные поля в общий CONTRACT/JSON Schema. Код и личные handoff их уже фиксируют; наличие ACK владельцев не предполагается.

Браузерный полный audio → review → approve → export E2E ещё не подтверждён этим аудитом. Следующий шаг Meiirlan — принять `36352d8` с этой quality limitation, объединить с новым main 4c861c7 и проверить общий путь с новым frontend и окружением. Новых сетевых вызовов, тестов или правок кода при подготовке freeze-отчёта проверяющий агент не выполнял.

## История проверки до исправлений

Все нижеописанные ожидания исправлений и отсутствующие тесты относятся к ранним snapshot a5ba34d/6040eb0. Их актуальное состояние определяется таблицей RESOLVED выше; это сохранённая история аудита, а не текущий список блокировок AI. **Frontend-выводы по main 4a29f0a также superseded новым bab31ea/4c861c7 и требуют повторной проверки.**

Первый проход: 2026-09-23 16:11 UTC+5. Удалённые ссылки обновлены успешным `git fetch origin` в этом проходе. Проверка чтением кода и Git; продуктовый код, ветки и чужой checkout проверяющий агент не менял. Этот файл — единственная его правка.

**Статус: интеграция в работе, общий READY не подтверждён.** Root сообщил, что переносит проверенный main в локальную AI-ветку. Ниже зафиксирован baseline до этого переноса; незакоммиченные изменения root/ai_quality_worker и последующие SHA требуют прицельной повторной проверки. Периодический повтор каждые 10 минут настроен root отдельно.

## Проверенные ревизии

| Ссылка | Полный SHA | Относительно main: ahead / behind |
|---|---|---|
| origin/main | `4a29f0aabcec3a36f104e77bd369825aa43f0a64` | 0 / 0 |
| origin/api | `e831ba75c2a64853eabcc13386c123b6562f05d8` | 0 / 10 |
| origin/frontend | `241b11f96806d12777c9027adf2d1f8d54c92723` | 0 / 26 |
| codex/ai-implementation и origin/codex/ai-implementation | `a5ba34d85a0079ac742b0e1d28908ad93db3e7da` | 16 / 17 |

API и frontend refs уже предки main; актуальный frontend следует оценивать по main. Общая база AI с main/api — `b6be3804c5df5030ed54ec6a9c8c1976dff6cb59`. AI относительно api: ahead 16 / behind 7; AI относительно origin/frontend: ahead 25 / behind 0.

`git merge-tree <base> <target> <AI>` подтвердил одинаковые пять конфликтов для main→AI и api→AI:

- `.env.example`
- `README.md`
- `backend/app/config.py`
- `backend/app/pipeline.py`
- `scripts/demo_e2e.py`

Проверяющий агент выполнил только старую форму merge-tree с выводом diff; index и рабочее дерево она не изменяла. Вывод конфликтов проверен по маркерам, код возврата этой формы команды сам по себе не означает отсутствие конфликта. Для frontend→AI конфликтов нет, поскольку frontend является предком AI. Новые незакоммиченные изменения schema в этот расчёт не входят.

## Готовность AI-модуля отдельно

**Baseline AI пригоден как реализованный модуль для дальнейшей интеграции, но ещё не совместим по всей семантике с v0.2.** В AI есть локальные `backend/stt/engine.py`, `diarize.py`, `audio.py`, реальный `backend/agents/runner.py` и eval. В main на проверенном SHA этих real-модулей ещё нет: STT и pipeline импортируют их только при включении real.

Контракт функций совместим: `transcribe(Path, lang) -> list[Segment]`, `async propose(RunInput, emit) -> Proposal`, `async execute(Proposal, emit) -> Result`. Основные оставшиеся несоответствия:

1. AI `runner.py:343` проверяет цитаты, но при создании `AssignmentDraft` сохраняет лишь assignee/task/deadline/deadline_text/source_segments. Проверенные evidence теряются. Main `review.py:38` затем подставляет полные реплики с `field=context`; это транспортно допустимо, но теряются исходные короткие цитаты и связь с конкретным полем. Нужно вернуть проверенные evidence из AI прямо в каноническую схему.
2. AI `runner.py:400` в execute пропускает только строку `Не указан`. При разрешённом v0.2 `assignee=null` формируется `Excerpt(recipient=None)`, что невалидно; `review_status=excluded` также не учитывается. Main `pipeline.py:206` передаёт полный approved proposal в execute и фильтрует excluded лишь позднее при создании записей БД. AI execute должен пропускать null/неизвестного исполнителя и excluded без LLM.
3. Main `review.py:55` пересчитывает `owner_uncertain` по null, а `deadline_conflict` — по `deadline_candidates`. AI должен передавать эти значения семантически согласованно: строка `Не указан` не воспринимается как null, одна причина `deadline_conflict` без нескольких кандидатов будет удалена сервером.
4. Baseline STT возвращает строковые `UNKNOWN`/`OVERLAP` без review flags (`engine.py:79–92`). Main schema позволяет speaker=null, speaker_candidates и review_reasons. Требуется согласованный переход, чтобы эти строки не показывались как подтверждённые личности.
5. AI ранее намеренно не использовал дату встречи при формировании prompt (`runner.py:368`). Main теперь передаёт `meeting_date=None` и `meeting_date_verified=false`, когда дата не подтверждена. Нужно сохранить этот запрет на домысливание даты при адаптации.

## Канонические поля v0.2

Основа — `origin/main:backend/shared/schemas.py`, уже используемая review/API. Не вводить второй несовместимый формат говорящих.

| Объект | Реализованный формат main |
|---|---|
| Evidence | segment_index, quote, start/end, field=`task|assignee|deadline|context`, kind=`raw_transcript|human_audio_correction` |
| AssignmentDraft | nullable assignee, evidence, deadline_candidates, review_status=`unreviewed|confirmed|corrected|excluded`, review_reasons, review_note, confidence=null |
| Speaker | label, participant_name, mapping_status=`unmapped|suggested|confirmed`, source_segments |
| Proposal | speakers как совместимый dict, speaker_records как list[Speaker], revision, source_mode |
| Segment | nullable speaker, speaker_candidates, corrected_text, review_reasons; raw text сохраняется отдельно от исправления |
| RunInput | nullable meeting_date и meeting_date_verified |

`review_reasons` у AssignmentDraft — enum: owner_uncertain, deadline_conflict, deadline_unknown, location_uncertain, scope_incomplete, speaker_uncertain, overlap, evidence_missing, audio_protocol_mismatch. Новые причины требуют явного совместимого расширения.

На момент проверки ai_quality_worker имел незакоммиченный черновик `SpeakerRecord(speaker, person_name, confirmed, ...)` и `Evidence.field=speaker`, несовместимый с main `Speaker(label, participant_name, mapping_status, ...)` и enum field. Root уведомлён; сообщил об остановке этого черновика и переходе на main v0.2. Это наблюдение baseline, не утверждение о финальном коде.

В main `pipeline.py:178` непустые `proposal.speaker_records` **сохраняются**: fallback строит records только при пустом списке. Сервер сам задаёт revision/source_mode. `review.py:95` проверяет label, participant_name и полный набор source_segments; `unconfirmed_speakers()` требует mapping_status=confirmed для связей, использованных в поручениях. Если AI добавляет кандидатов/цитаты говорящего, расширять существующий Speaker опциональными полями, не переименовывать используемые API поля. Требуется согласование владельцев shared schema.

## Фактическое подключение frontend в main

**API/SSE подключены частично.** `createServices.ts:26` создаёт ApiRecordingGateway только при VITE_API_URL. Микрофон вызывает POST `/api/runs/recordings`, POST `/chunks` и POST `/finish`; затем `RecordingProgress` получает SSE `/events` и GET run.

Подтверждённые блокеры полного сценария:

1. **Upload не запускает AI.** `useNewMeetingModel.ts:129` передаёт файл в createMeeting; `MeetingService.ts:15` записывает его через локальный репозиторий Dexie. В frontend/src нет POST `/api/runs` с файлом. Это также отмечено владельцем API в STATUS 15:54.
2. **SSE используется только как прогресс.** `ApiRecordingGateway.ts:14–16` оставляет от StepEvent только seq/content; GET run на строках 81–85 читает лишь run.status и steps. RunProgress содержит status/steps. Proposal, evidence, review_reasons, speaker_records, revision, approved и timed transcript не импортируются в карточку.
3. **Save/approve отсутствуют.** В frontend/src не найдены вызовы PUT proposal или POST approve. Карточка редактирует локальные данные; показ `awaiting_approval` не даёт завершить серверный run.
4. **Экспорт остаётся локальным.** `useMeetingModel.ts:90–103` передаёт локальную meeting/tasks в BrowserMeetingExporter без проверки approved snapshot. Это не экспорт утверждённого сервером результата.
5. **Авторизация разрывает доступ.** При чистой сессии frontend SecurityRoute отправляет на login; ApiAuthGateway.restoreSession без сохранённого токена возвращает null. Backend по умолчанию AUTH_MODE=disabled, а Auth.login в этом режиме отвечает 404. Для AUTH_MODE=local запись тоже не готова: createServices создаёт новый AxiosHttpClient без Bearer, ApiRecordingGateway не добавляет Authorization и использует обычный EventSource. Токен явно добавляется только в auth `/me`. Поэтому подключённый код записи не равен подтверждённому браузерному E2E.

Язык `mixed → rukk`, пути recording/chunks/finish, события `step/status` и серверные статусы в gateway соответствуют API. Для будущего adapter нужны отдельные transport-типы: текущий frontend Segment содержит id/speaker/role/text и не хранит start/end; MeetingStatus draft/ready/pending не совпадает с RunStatus; это допустимо только при явном преобразовании без потери raw/evidence.

## Зависимости и проверки

Проверено без чтения `.env`, загрузки моделей или обращения к LLM:

- `.venv/bin/python`: **3.11.11**. Main `pyproject.toml:5`, setup.sh и `readiness.environment_checks:77` требуют **≥3.12**. `run_local.sh:34` останавливается при неуспешном preflight; текущая среда не соответствует заявленному запуску.
- Установлены torch/torchaudio 2.10.0, pyannote.audio 4.0.7, onnxruntime 1.21.1, soundfile 0.13.1, pydantic 2.13.5, openai 3.19.0, fastapi 0.141.1, sqlmodel 0.0.46, pytest 9.1.1. Локальные STT model.pt/tokens.lst, vad.onnx и каталог диаризации существуют; ffmpeg найден. Полнота весов/новый real-run в этом проходе не проверялись.
- `pip check` завершился с кодом 1: общая среда содержит конфликты сторонних OCR/langchain/streamlit/telemetry пакетов. Это факт несогласованной среды, а не доказательство отказа AI-пути. Устанавливать/удалять зависимости проверяющий агент не стал.
- Main добавил backend/requirements.lock.txt (по STATUS получен на Windows/Python 3.14), AI requirements-stt добавляет pyannote.audio ≥4,<5; main setup уже отдельно ставит 4.0.7. API lock и ML среда ещё не образуют проверенную воспроизводимую установку на этом Mac.
- В AI checkout отсутствует frontend/node_modules; main требует Node ≥22.18 и имеет package-lock. Новый checkout или зависимости ради аудита не создавались.
- В main есть tests/test_contract_v02.py (evidence/revision/raw/snapshot/speaker review), test_recording.py, test_live_sse.py, test_readiness.py и другие API проверки. Frontend имеет architecture/typecheck/tests/build и recording.test.ts, но этот тест проверяет BrowserRecorder с fake platform, не ApiRecordingGateway/SSE/approve.
- Последние записанные результаты: AI handoff сообщает **36 pytest, 25 guard, 12/12 валидных Luna proposals, 9/9 ожидаемых поручений**; main STATUS сообщает **109 backend tests** и отдельный upload smoke. Это ранее выполненные проверки их владельцев, не новый прогон объединённой версии. В этом read-only проходе pytest/build/live demo не запускались.

## Следующий конкретный шаг

Root завершает локальное объединение с зафиксированным main и разрешает пять конфликтов с сохранением v0.2 review/recording/readiness и проверенного AI поведения. ai_quality_worker адаптирует runner к каноническим Evidence/Speaker, сохраняет цитаты, обрабатывает null/excluded. Затем прицельный повтор по новому SHA: contract_v02 + AI quality + execute(null/excluded), mock upload→review→save→approve→DOCX/PDF и проверка guard без внешних вызовов.

Отдельно владельцу frontend нужен конкретный adapter: file→POST runs; GET run/needs_approval→серверный proposal; сохранение revision; review/speaker confirmation; approve; экспорт из approved/files. Одновременно согласовать вход в AUTH_MODE=disabled либо передачу Bearer для API и SSE. До этого browser AI demo остаётся BLOCKED независимо от готовности STT/runner.

Новый merge SHA, результат новых тестов и исправление перечисленных причин должны появиться отдельным дополнением к этому baseline. Этот отчёт не является ACK владельцев shared/API/frontend и не разрешает merge в main или push.

## Повтор после объединения — 16:17 UTC+5

Проверен commit `6040eb0b39c385c7e2ed208a5eac60b33939343f`. Относительно ранее fetched `origin/main=4a29f0aabcec3a36f104e77bd369825aa43f0a64` AI **ahead 17 / behind 0**; main является предком HEAD. `git ls-files -u` пуст, все пять прежних конфликтов разрешены. Относительно origin/AI (`a5ba34d`) локальная ветка ahead 18 / behind 0. Новый fetch в этом прицельном проходе не выполнялся: проверяется именно согласованный root snapshot main 4a29f0a, а не заявление о неизменности GitHub после первого fetch.

Во время проверки root и ai_quality_worker уже меняют runner/shared и backend persistence/review. Ниже проблемы относятся к зафиксированному 6040eb0; увиденные исправления рабочего дерева пока не считаются проверенным результатом. Продуктовые файлы проверяющий агент не менял.

Три наиболее существенные оставшиеся темы для передачи AI v0.2:

1. **Evidence и review теряются в реестре поручений.** В 6040eb0 `Assignment` хранит source_segments, но не evidence/review_reasons/review_status/review_note/assignee_candidates; pipeline.execute передаёт только прежний набор полей. Approved snapshot сериализует Proposal целиком и должен сохранить поля, но `/api/assignments` получает их из более узкой модели. Root уже добавляет хранение/миграцию: нужен точный тест соответствия approved → Assignment → API, включая повторное чтение и source_segments.
2. **Runner должен завершить переход на v0.2.** В committed 6040eb0 он всё ещё теряет проверенные evidence при создании AssignmentDraft и execute не пропускает null/excluded. Во время повтора рабочая версия уже сохраняет evidence, использует nullable owner, канонический Speaker и пропускает null/excluded. Это исправление нужно принять вместе с backend, проверить целиком и зафиксировать SHA; старый merge commit сам по себе не подтверждает готовность.
3. **Проверка источников допускает снятие блокировки без исправления.** На коде review.py из 6040eb0 выполнены два полностью вымышленных in-memory примера без импорта config, `.env`, файлов БД или сети. Цитата `!!!` проходит strict check, потому что normalize(quote) пуст и считается подстрокой любого текста; blocking возвращает пустой список. Неверная AI-цитата сначала получает evidence_missing и fallback полной репликой, но повторное сохранение неизменённого proposal через strict=True удаляет evidence_missing и снимает блокировку. Root уведомлён и меняет review. Новые Speaker.evidence должны проходить такую же проверку источника; текущая базовая проверка speaker_records проверяет label/name/indices, но не цитаты.

### Что именно покрывают тесты main

| Тест | Что проверяет | Чего не доказывает |
|---|---|---|
| test_api.py:test_demo_flow | evidence присутствует в pending proposal; confidence=null; общий demo flow | Сохранность конкретных quote/field/kind после approve и в реестре |
| test_contract_v02.py:test_evidence_times_come_from_segment | PUT proposal заменяет присланные start/end временем raw-сегмента | Повторный GET, approved snapshot, Assignment/API |
| test_contract_v02.py:test_save_revision_and_raw_transcript_immutable | Ревизия, immutable raw, corrected_text, сохранённый assignee | Полное сравнение evidence/review/speaker fields |
| test_contract_v02.py:test_approve_snapshot_idempotent_and_exports | approved revision, reviewed status, повтор approval, summary в DOCX, порядок stages | Сохранность evidence в approved/assignments и неизменность всех AI полей |
| test_api.py:test_edited_approval_and_double_submit | task/deadline после approval, source_segments в Assignment БД | Evidence/review поля отсутствуют в assertions |
| test_contract_v02.py:test_conflict_blocks_approval_until_excluded | Deadline conflict блокирует, excluded отсутствует в реестре | Excluded отсутствует в real execute excerpts; null owner не ломает real runner |
| test_contract_v02.py:test_assignment_speaker_mapping_must_be_confirmed | Suggested mapping, используемый поручением, блокирует approval | Round-trip дополнительных Speaker.evidence/candidates и проверка самих цитат |

**Точного существующего теста `evidence → save → approved snapshot → persisted Assignment → GET /api/assignments` нет.** Test suite main также не проверяет punctuation-only quote и повторное сохранение fallback после неверной AI-цитаты.

Минимальный приёмочный тест после текущих правок: синтетический proposal с непустыми evidence по полям, owner=null, review_note, candidates и Speaker records проходит GET/PUT/approve; затем сравниваются точные quote/field/kind/start/end в approved и реестре, исходный transcript неизменён, null/excluded не попадают в excerpts, ошибочная/пустая после нормализации цитата не снимает блокировку. Выполнять через mock LLM/STT без внешних запросов. Root пишет этот тест в своей зоне.

Итог повтора: **Git-синхронизация готова; AI/backend readiness ожидает завершения уже выполняемых исправлений и одного совместного теста.** Новый независимый инфраструктурный blocker сверх ранее известных frontend auth/review и Python preflight не обнаружен. Полный pytest/browser/E2E в этом read-only повторе не запускался; два чистых примера review выполнены и воспроизвели описанные дефекты.
