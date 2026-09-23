# DECISIONS

- [13:30] Кейс: «Система автопротоколирования совещаний с фиксацией поручений» (docs/TASK.md).
- [13:30] STT: своя модель Alibi `alibiserikbay/kazakh-russian-mixed-stt` (Apache-2.0, публичная, обучена до хакатона), `asr/rukk`, CPU, жадный CTC. KenLM и Whisper — в cut list.
- [13:30] Закрытый контур: STT только self-hosted; LLM через OpenAI-совместимый клиент с `LLM_BASE_URL` (vLLM + gpt-oss на Brev). Использование OpenAI API на синтетике — ждём ответа организаторов.
- [13:30] Контракт: propose() получает готовый транскрипт; STT и диаризация — отдельный слой backend/stt; needs_approval и final эмитит бэкенд.
- [13:30] Вход MVP: загрузка файла. Бот для Teams/Zoom/Meet и live-поток — в cut list.

- [13:59] Frontend: React + TypeScript + Vite в frontend/; Mantine — основной UI, Tailwind — точечные utilities без Preflight (выбор пользователя). Mantine Form и overlays выбраны для форм, фокуса и диалогов; React Router — для маршрутов и защиты активной записи; Dexie/IndexedDB — для локальных данных и медиа; docx — для клиентского DOCX; lucide-react и локальный Inter — для общих иконок и типографики. PDF доступен через печать браузера. API/SSE и интеграция ИИ остаются отдельной работой; CONTRACT.md и backend/shared/schemas.py сохранены.
