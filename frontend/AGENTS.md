# frontend — Nurdaulet (WEB)

- Сохранять реализованный frontend: React 19.3, Vite 8.3, TypeScript, Mantine, Dexie/IndexedDB, React Router, docx, lucide и локальный Inter; точные версии в package-lock.json. npm, dev-порт 5174. Не заменять стек ради старого плана. Внутренние решения принимает Nurdaulet; границы работы — docs/COORDINATION.md.
- API пока не подключён в проверенном main 7bae7c2. Базовый URL и mock adapter согласовать с Meiirlan; VITE_FAKE и src/dev/fakeStream.ts не считать существующей реализацией. Mock должен использовать согласованный формат StepEvent и явно показывать свой режим.
- Демо-путь из docs/DEMO.md первым: загрузка записи (с уведомлением о записи и ИИ-транскрибации) → живой трейс агентов →
  аудиоисточник → проверка и правка черновика → утверждение revision → скачать DOCX/PDF. Дашборд и напоминания в cut list.
- На каждом экране состояния loading, empty, error. Крупный шрифт и контраст для проектора, работает на мобильном.
- Трейс рисует StepEvent по seq и не блокируется на одном событии. EventSource закрывать на статусах done / rejected / error.
- API и v0.2 schemas в docs/CONTRACT.md; source_segments — неизменные индексы raw transcript. Не отправлять новые неизвестные backend поля без синхронизации с Meiirlan.
- На экране видны real/mock/replay, процесс review и происхождение данных. Saved real-run не называть live.
- Таймкоды сегментные, не точные слова. Assignee может отсутствовать/быть внешним; deadline_text сохраняется даже при null deadline. Спорные поля и speaker mapping требуют ручной проверки.
- Цель интеграции: сохранение proposal с expected_revision, 409 = обновить snapshot. Для API-run экспорт из approved snapshot после approve; сохранить уже готовые клиентские DOCX/печать PDF по согласованию с Meiirlan. Локальные примеры не объявлять утверждённым AI-результатом. Счётчик «проверено» не означает вероятность модели.
- В planning-only задачах менять только инструкции/документы, не scaffold приложения.
- Перед мержем: сборка проходит, ui_tester прошёл сценарий на localhost.
- Зависимости frontend и package-lock — область Nurdaulet; причину изменения передать через docs/handoffs/nurdaulet.md, общий журнал сводит Meiirlan.
