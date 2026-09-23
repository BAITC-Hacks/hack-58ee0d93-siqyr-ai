# backend/app — Meiirlan (API)

- Стек: FastAPI + SQLModel + SQLite (docs/STACK.md главнее). Маршруты — ровно как в docs/CONTRACT.md; перед изменением запусти $contract-guard.
- Настройки только из config.py (читает .env). Пути к данным — через settings.data_dir. Пустой/внешний LLM endpoint в local запрещён; нынешний cloud default должен быть исправлен в первой implementation-задаче, не в planning-only ходе.
- emit() сохраняет шаг в SQLite и пушит его в SSE. SSE шлёт heartbeat. CORS разрешает origin фронта.
- AGENT_MODE=mock|real выбирает backend/agents/runner_mock.py или runner.py. STT_MODE=mock|real — backend/stt.
- DEMO_MODE=replay проигрывает сохранённый прогон с исходными паузами.
- Replay маркируется явно; хранить actual durations, не создавать видимость live. Один background worker, STT не блокирует event loop; SSE reconnect по seq.
- LLM_PROVIDER=dev_openai только для доверенного synthetic manifest, никогда для upload/исходных встреч. Через backend/app/llm.py один adapter-интерфейс; local к 15:00, без cloud fallback. Tracing отключён.
- docs/CONTRACT.md v0.2 сейчас опережает backend/shared/schemas.py v0.1. Миграция принадлежит Meiirlan после сверки с Alibi; не молча менять API.
- Raw audio/transcript неизменяемы. proposal save с optimistic revision, approve создаёт immutable snapshot. Идемпотентный повтор approve; файлы только из approved snapshot, до него 409. execute не повторяет LLM и не меняет поля.
- Проверять evidence indices/quotes/time bounds, raw deadline/normalized date/null. При неизвестной дате встречи не подставлять today. Исполнитель не обязан выступать; отдел допустим.
- Экспорт: согласовать один путь с Nurdaulet. Уже есть клиентские DOCX/печать PDF; предпочтительно передавать им approved snapshot. Серверные python-docx/fpdf2 нужны только при согласованном выборе server export. Проверять ә ғ қ ң ө ұ ү һ і.
- Напоминания (сценарий 2): после сквозного ядра, только локально. Внешние рассылки и deployment вне MVP.
- Тесты — в tests/, с AGENT_MODE=mock и STT_MODE=mock. Мержи в main делает Meiirlan.
