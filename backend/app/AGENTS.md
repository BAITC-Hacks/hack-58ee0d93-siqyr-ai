# backend/app — Meiirlan (API)

- Стек: FastAPI + SQLModel + SQLite (docs/STACK.md главнее). Маршруты — ровно как в docs/CONTRACT.md; перед изменением запусти $contract-guard.
- Настройки только из config.py (читает .env). Пути к данным — через settings.data_dir.
- emit() сохраняет шаг в SQLite и пушит его в SSE. SSE шлёт heartbeat. CORS разрешает origin фронта.
- AGENT_MODE=mock|real выбирает backend/agents/runner_mock.py или runner.py. STT_MODE=mock|real — backend/stt.
- DEMO_MODE=replay проигрывает сохранённый прогон с исходными паузами.
- Экспорт протокола: DOCX (python-docx) и PDF (fpdf2 со шрифтом, где есть ә ғ қ ң ө ұ ү һ і).
- Напоминания о сроках (сценарий 2 из ТЗ): фоновая проверка + ручной запуск через API.
- Тесты — в tests/, с AGENT_MODE=mock и STT_MODE=mock. Мержи в main делает Meiirlan.
