# Архитектура MVP

Это целевая архитектура по PLAN/CONTRACT, ещё не отчёт о полной реализации.

```text
Браузер 127.0.0.1:5174 (dev; Docker web — 5173)
    → FastAPI localhost:8000 → SQLite + local raw audio / raw transcript
    → FFmpeg → VAD + pyannote → TorchScript STT → speaker labels
    → backend/app/llm.py → local Ollama → proposal + evidence + review reasons
    → секретарь: источник аудио, имена, правки, утверждение revision
    → immutable snapshot → deterministic execute → готовый клиентский DOCX / печать PDF
      (предложение переиспользования; путь экспорта согласуют Meiirlan и Nurdaulet)

Отдельная dev-ветка: доверенный synthetic fixture → OpenAI API → тот же proposal contract
Отдельные GPU-тесты: synthetic fixture → уже настроенный Brev
```

Исходные встречи не имеют пути в dev API. При недоступном local LLM обработка завершается ошибкой с сохранённым transcript, без fallback в облако. Real/mock/replay и физическое местоположение LLM видны. В SDK отключён hosted tracing, assets локальные.

Одна очередь/worker; синхронные ML-этапы не блокируют API/SSE. События сохраняются с seq, UI может восстановиться после refresh. Индексы raw segment стабильны. JSON validation дополняется проверкой ссылок, дат и ревизий. Speaker и ответственный — разные сущности; ручная связь speaker→name не считается биометрической идентификацией.

Саммари и поручения могут получаться одним вызовом; UI показывает этапы, не выдуманное число независимых агентов. После approval нет генеративного изменения содержания. Расширение после пилота: durable workers, организация доступа, СЭД и уведомления, не часть текущей гарантии.
