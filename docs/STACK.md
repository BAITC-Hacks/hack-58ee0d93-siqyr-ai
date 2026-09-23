# Стек и запуск

План от 23 сентября 2026. Сохраняем структуру текущего каркаса. Ниже целевые версии для lock после smoke, а не заявление о протестированной совместимости. Продуктовый код и requirements в этом планировании не меняются. Фактическое окружение и SHA весов Alibi/Meiirlan фиксируют до 14:15; не обновлять зависимости после 16:15.

## Железо и выбранные режимы

**Последнее уточнение команды:** $50 на каждый предоставленный OpenAI API-ключ и $50 всего на Brev. Число API-ключей не подтверждено; не складываем бюджет автоматически. Разрешено использовать ресурсы для GPU, тестирования и синтеза данных. Разработка сначала через OpenAI API на полностью синтетических inputs, затем переключение на локальную LLM. Для исходных встреч облачный этап не допускается.

- Текущий доступный Mac: macOS 14.5, Apple M1 Pro 8 cores, 16 GB RAM. Ollama client 0.34.0 установлен, сервер при проверке не запущен; FFmpeg 8.0 установлен. Системный Python 3.14.4 не содержит STT-пакетов — не использовать его для нового ML env.
- Nurdaulet: M3 Pro, RAM и ОС ещё не уточнены. Meiirlan — владелец демонстрации; остальные параметры его и Alibi ноутбуков неизвестны. Не приписывать им параметры текущей машины.
- Brev уже авторизован и настроен по сообщению команды. GPU, VRAM, image и модели нужно проверить. Наличие аккаунта не означает готовый inference endpoint или разрешение на передачу данных.
- **Обязательный путь: ноутбук, Qwen3 4B.** Резерв: 1.7B. Для 16 GB модели загружаются последовательно, одна встреча за раз. Разумный плановый запас диска — 15 GB, включая env и кеш; это оценка, не размер весов.
- gpt-oss:20b пробовать только после готового MVP на GPU/машине с запасом памяти. OpenAI указывает ≥16 GB памяти для модели; для всего приложения 24–32 GB — наш инженерный запас, не официальный минимум. На Brev — синтетические тесты до подтверждения контура.

## Компоненты

| Слой | Целевая версия / артефакт | Решение |
|---|---|---|
| Python | 3.12.x, patch зафиксировать из рабочего env | Соответствует pyproject; отдельная `.venv`, не системный 3.14. |
| Декодирование | FFmpeg 8.0 на текущем Mac | Через subprocess в PCM float32 16 kHz mono; в pyannote передавать waveform в памяти. |
| VAD | `vad/vad.onnx` из модели Alibi; SHA256 в manifest, onnxruntime 1.22.1 | Не убирать тишину со сдвигом временной шкалы. Smoke отдельно, не путать VAD с диаризацией. |
| STT | `asr/rukk/model.pt` + соответствующий `tokens.lst`; torch 2.8.0; numpy 2.2.6 | Greedy CTC, CPU, исходный рабочий путь evaluate_stt.py — база адаптера. Идентичность локальных ADM и HF весов проверить hash, не предполагать. |
| Диаризация | pyannote.audio 4.0.7 + speaker-diarization-community-1 | CPU по умолчанию; gated скачивание до offline; torchaudio 2.8.0, torchcodec 0.7.0; совместимость проверить коротким waveform smoke. |
| Файлы/модели | soundfile 0.13.1, huggingface-hub 0.35.3 | Скачиваем только нужные артефакты. Если resolver сообщает конфликт, согласованный lock важнее этой целевой таблицы. |
| Локальная LLM | Ollama 0.34.0; `qwen3:4b` Q4_K_M; резерв `qwen3:1.7b` Q4_K_M | Сохранить digest после pull. 8K context, temperature 0, thinking выключен, один structured вызов; таймаут 120 секунд для короткого demo, actual измерить. |
| Backend | FastAPI 0.115.12, uvicorn 0.34.2, SQLModel 0.0.24, pydantic 2.11.7 | SQLite, один worker/очередь на один запуск; SSE и хранение событий. |
| Клиент LLM | httpx 0.28.1; OpenAI-compatible adapter | `backend/app/llm.py`, только разрешённый endpoint. Ollama native `/api/chat` допустим внутри adapter для schema/think; общий контракт агентов не меняется. |
| Agents SDK | Не обязательная зависимость рабочего MVP | Оставляем `propose/execute` и реальные StepEvent; не тратим время на четыре агента. Если используем уже рабочий SDK — отключить tracing и проверить, что схема поддержана провайдером. SDK сам по себе не подтверждает использование hosted API. |
| UI, уже в main | npm/package-lock; React 19.3.0, Vite 8.3.0, TypeScript ^5.9.3, Mantine 9.6.2, Dexie 4.4.6, React Router 7.18.4 | Сохраняем текущие экраны, Tailwind utilities, lucide и локальный Inter. Точные версии в frontend/package-lock.json; npm run build проверен на main 7bae7c2. |
| DOCX/PDF | В main: docx 9.7.1 в браузере, PDF через печать | Сохранить готовый экспорт, подключить approved snapshot после согласования Meiirlan/Nurdaulet. Серверные python-docx/fpdf2 — альтернатива, не параллельная задача. Проверить `Ә Ғ Қ Ң Ө Ұ Ү Һ І`. |
| Тесты | pytest 8.4.2 | API/approval/таймкоды/экспорт, eval отдельно; npm run build для UI. |

Версии верхнего уровня — стартовый выбор; конечные `requirements*.lock.txt`, существующий frontend/package-lock.json и manifest являются доказательством воспроизводимости. Не обещаем, что набор уже установлен или прошёл тесты.

## OpenAI сначала и переключение на локальную модель

Один интерфейс `extract(run_input) -> Proposal` и одна схема, два адаптера: `dev_openai` и `local`. Сигнатуры propose/execute и API фронта при переключении не меняются. До 14:15 разрешён hosted API для синтетических fixtures и проверки парсинга; до 15:00 локальная модель должна пройти тот же smoke; к 15:30 полный real-путь только local. Нельзя откладывать первую проверку local до заморозки.

Hosted model для этого этапа: `gpt-4.1-mini-2025-04-14` ([официальная карточка](https://developers.openai.com/api/docs/models/gpt-4.1-mini)); доступ ключа проверяется отдельно. Запросы через httpx к Responses/Chat Completions, без необходимости Agents SDK; точные параметры перед реализацией сверяет docs_researcher. Никаких исходных аудио, транскриптов, DOCX, цитат или их перефразированных фрагментов в dev_openai. Тестовые истории создаются с нуля; один флаг synthetic от клиента не является доказательством происхождения. Принимаются только fixtures доверенного генератора с manifest. Реальная загрузка файла в облачном профиле отклоняется сервером.

Meiirlan добавляет `LLM_PROVIDER=local|dev_openai` и явные разрешения профиля. Переключение — конфигурация, не переписывание UI. При local-ошибке не пробовать dev_openai. OpenAI tracing отключён и в local Agents SDK, если он используется. Плановый лимит трат: до $5 на ключ на synthetic/dev, предупреждение на $10, остановка dev-запросов на этом командном лимите; $50 — доступный потолок, не цель расходования. Brev: предупреждение на $10 и целевой потолок $15 на первые эксперименты; перед стартом узнать $/час и остановить idle GPU после теста. Не обещаем экономию или стоимость без actual usage.

## Как соединяем аудио и текст

FFmpeg → VAD/диаризация на исходной временной шкале → STT по репликам → speaker mapping с подтверждением → один локальный LLM propose → review → execute approved snapshot → DOCX/PDF.

Реплики одного говорящего объединять только если между ними нет другого; длинные резать не более 18 секунд. Коротким фрагментам давать небольшой контекст для STT, но сохранять исходные границы и не присваивать текст соседнего голоса уверенно. Перекрытия маркировать для проверки. Метки — сегментные, не словесные. Если диаризация ухудшает STT, сохраняем baseline chunks и unresolved speaker для пересекающихся голосов; не присваиваем всему 15-секундному смешанному куску один голос по большинству без флага.

## Загрузка и время

| Артефакт | Размер | Нижняя граница при 50 Mbit/s | Практический резерв |
|---|---:|---:|---:|
| Mixed STT | ~721 MiB; локальный model.pt уже найден, 756007202 байта | ~2 мин | 3–5 мин при скачивании; 0 если подтверждён локальный файл |
| VAD | ~1.7 MB | <1 с | <1 мин |
| Qwen3 4B | 2.5 GB | ~6.7 мин | 8–15 мин |
| Qwen3 1.7B | 1.4 GB | ~3.7 мин | 5–10 мин |
| pyannote bundle | Точный объём не измерен; для планирования резерв 1 GB | До ~2.7 мин при этом резерве | 5–10 мин + принятие условий человеком |
| gpt-oss 20B | Размер проверить по выбранному registry artifact | Не обещаем | Не блокирует основной путь |

Оценки вычислены как bytes / bandwidth, не замеры сети. При 10 Mbit/s время загрузки примерно в 5 раз больше. Пакеты Python/Node сверх этих чисел. Сразу запускать pull основной модели; fallback скачивать, если позволяет сеть. Не клонировать 9 GB STT-репозиторий целиком.

## Команды

В этом разделе чётко различены существующие команды и контракт будущих scripts. Backend пока реализует только health; frontend уже работает самостоятельно. Полный сценарий ниже — задачи PLAN.md. В отдельной проверке main 7bae7c2 прошли npm ci, npm run build и один health-тест; это не E2E.

### Сейчас воспроизводимый старый STT-тест

```bash
python3 evaluate_stt.py --model rukk
```

Требует того Python/env, где уже работал тест, FFmpeg и локальных ADM путей из evaluate_stt.py. Это пока не переносимая установка; Meiirlan должен заменить абсолютную зависимость на STT_MODEL_DIR в адаптере, сохранив baseline-скрипт.

### Подготовка Mac и локальной LLM

Python 3.12 и поддерживаемый текущим frontend Node/npm проверяются до setup; наличие `python3.12`, `node --version` и совместимость с frontend/package.json проверяет оператор. Рабочий frontend env не переустанавливать ради прежнего плана. Существующий FFmpeg не переустанавливать. Для первого скачивания нужна сеть.

```bash
python3.12 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.txt
.venv/bin/python -m pip install -r backend/requirements-stt.txt
OLLAMA_HOST=127.0.0.1:11434 OLLAMA_NO_CLOUD=1 ollama serve
```

Во втором терминале:

```bash
ollama pull qwen3:4b
ollama pull qwen3:1.7b
ollama list
```

После фиксации версий использовать lock-файлы вместо нынешних диапазонов `>=`. Весам HF нужен отдельный подготовительный шаг: `hf auth login` (токен не вставлять в git/логи), принять условия pyannote на сайте, затем:

```bash
.venv/bin/hf download alibiserikbay/kazakh-russian-mixed-stt --include 'asr/rukk/*' 'vad/*' config.json --local-dir models/stt
.venv/bin/hf download pyannote/speaker-diarization-community-1 --local-dir models/diarization
```

Адаптер должен грузить pyannote из `models/diarization`, STT из `models/stt`; offline preflight проверяет все зависимые веса, а не только верхний config. Сохраняем repo revision, hash и license; models/ не коммитим. Если переносим локальные ADM веса, отдельно копируем соответствующий tokens.lst и фиксируем hash.

### Целевой ручной запуск после реализации

```bash
AGENT_MODE=real STT_MODE=real DEMO_MODE=live \
LLM_BASE_URL=http://127.0.0.1:11434/v1 LLM_API_KEY=local \
MODEL_MAIN=qwen3:4b MODEL_FAST=qwen3:1.7b \
STT_MODEL_DIR=models/stt DIARIZATION_MODEL_DIR=models/diarization \
HF_HUB_OFFLINE=1 HF_HUB_DISABLE_TELEMETRY=1 PYANNOTE_METRICS_ENABLED=0 \
OPENAI_AGENTS_DISABLE_TRACING=1 \
.venv/bin/uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
```

```bash
npm --prefix frontend ci
npm --prefix frontend run dev
```

[14:57] STT_MODEL_DIR/DIARIZATION_MODEL_DIR, LLM_PROVIDER=local по умолчанию и запрет облачного fallback реализованы в config.py/readiness.py; engine.py Alibi должен читать веса из `settings.stt_model_dir`/`settings.diarization_model_dir`. Frontend уже имеет package-lock.json: использовать npm ci. Его dev origin — http://127.0.0.1:5174; CORS backend должен разрешать фактический origin.

### Команды, которые Meiirlan обязан предоставить и проверить

```bash
bash scripts/setup.sh --profile laptop --download-models
bash scripts/run_local.sh --profile laptop --offline
bash scripts/demo_e2e.sh --file <запись.wav> --meeting-date 2026-09-23 --mode real
```

[14:57] Scripts реализованы; `run_local.sh --api-only --offline` + `demo_e2e.sh` проверены в mock на чистом DATA_DIR (Windows/Git Bash), real-путь и Mac — ещё нет. Профиль `--profile laptop` единственный. Setup проверяет системные prerequisites, pins, шрифт, model manifest и доступ к gated весам; в случае отсутствия прав даёт инструкцию. Run запускает localhost сервисы и не скачивает ничего. `demo_e2e` проверяет реальные стадии, approval и два экспорта. Docker compose — дополнительный способ, не основной на Mac с Metal.

## Brev

Не заводить новый аккаунт и не поднимать второй GPU. Alibi проверяет уже настроенную машину и модель/VRAM. Только после разрешения контура: worker на loopback удалённой машины, SSH-туннель до localhost ноутбука, токен, закрытый порт, отсутствие внешнего tracing. SSH localhost не делает данные локальными физически; в health нужен `llm_location=remote_self_hosted`. До ответа организаторов — только полностью вымышленные inputs, без исходных протоколов и производных. Основной показ не зависит от сети. Выбор CUDA image и vLLM version откладываем до фактической GPU-инвентаризации; не обещаем не проверенный серверный профиль.

## CPU и отказоустойчивость

STT и diarization — CPU; LLM Ollama использует доступное ускорение либо CPU. Запускать стадии последовательно, освобождать память. Измеренные 27.52 секунды на 480.28 секунды — только acoustic inference существующего теста, не E2E SLA. Если новый 60–90-секундный demo дольше 120 секунд, использовать live 20–30 секунд и отдельно подписанный сохранённый полный прогон. При падении LLM сохранить транскрипт и показать ошибку; не переключаться на облако или скрытый mock. 8 GB — только эксперимент с 1.7B и коротким контекстом, без обещания пригодности.

## Проверенные источники

- [STT model card](https://huggingface.co/alibiserikbay/kazakh-russian-mixed-stt): формат, артефакты, ограничения.
- [pyannote Community-1](https://huggingface.co/pyannote/speaker-diarization-community-1): локальный CPU, gated доступ, offline и exclusive diarization. [Зависимости 4.0.7](https://raw.githubusercontent.com/pyannote/pyannote-audio/4.0.7/pyproject.toml).
- [Qwen3 4B](https://ollama.com/library/qwen3:4b), [1.7B](https://ollama.com/library/qwen3:1.7b): размеры/квантизация. Качество KK на наших данных не установлено.
- [Ollama JSON Schema](https://docs.ollama.com/capabilities/structured-outputs), [FAQ](https://docs.ollama.com/faq): структурированный ответ, контекст и runtime. Схема не гарантирует истинность полей.
- [OpenAI gpt-oss локально](https://developers.openai.com/cookbook/articles/gpt-oss/run-locally-ollama): ориентиры памяти и запуск; [модель](https://developers.openai.com/api/docs/models/gpt-oss-20b).
