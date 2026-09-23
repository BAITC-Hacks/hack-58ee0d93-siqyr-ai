# STATUS

Только дописываем: `- [HH:MM] <имя> done: ... | next: ... | gotchas: ...`

- [14:05] Codex planning done: заполнены PLAN/STACK/CRITERIA/CONTRACT/DATA/DEMO/README_OUTLINE/prompts и согласованы AGENTS/ROLES/ARCHITECTURE/AI_USAGE/DECISIONS; учтены $50 на API-ключ, $50 Brev, API synthetic-dev → local | next: команда запускает полосы по prompts.md; real E2E к 15:30, freeze 16:15 | gotchas: только документация; schemas.py и продуктовый код не менялись; JSON синтаксис/refs/required проверены, git diff --check пройден; полная metaschema-валидация не выполнялась; аудио-проверка спорных мест, модели, hardware Brev и согласие организаторов ещё предстоят. Никаких model downloads, API/GPU расходов, commit/push в ходе планирования.

- [13:59] Codex done: подготовлен PR frontend → main, приложение перенесено в frontend/ с сохранением backend и infra, npm ci, npm run build и Docker-сборка фронтенда проходят | next: review PR и отдельное подключение API/SSE/ИИ | gotchas: данные фронтенда пока только в IndexedDB; запись с физического микрофона не проверена; установленный Docker Compose не принимает существующий объект env_file из main.
