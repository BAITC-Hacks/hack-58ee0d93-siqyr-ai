# STATUS

Только дописываем: `- [HH:MM] <имя> done: ... | next: ... | gotchas: ...`


- [13:59] Codex done: подготовлен PR frontend → main, приложение перенесено в frontend/ с сохранением backend и infra, npm ci, npm run build и Docker-сборка фронтенда проходят | next: review PR и отдельное подключение API/SSE/ИИ | gotchas: данные фронтенда пока только в IndexedDB; запись с физического микрофона не проверена; установленный Docker Compose не принимает существующий объект env_file из main.
- [14:05] Codex done: JWT-вход, роли и изоляция департаментов, валидатор токенов Keycloak, одноразовый challenge ЭЦП с проверяющим адаптером; 34 теста проходят | next: подключить UI, realm заказчика и внутренний CMS-верификатор | gotchas: без JWT_SECRET и bootstrap-пользователя API не стартует; ЭЦП отключена без ECP_VERIFY_URL
