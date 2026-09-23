# Meet bot handoff

READY | meet_bot | codex/meet-bot@uncommitted | Контур демо без Workspace: личный аккаунт бота, ручной допуск, headed Chromium, локальный FileSink, CLI и HTTP-сервис. Текущий API записи подключается через `python -m meet_bot import-run`; контракт будущего `/api/sessions` представлен HttpSink. | Проверено: Python compileall, Node syntax, ручной вызов Lifecycle/FileSink. Полный pytest и браузерный loopback не запущены: в окружении нет pytest/httpx/Playwright и pip не находит пакет в доступном индексе. Реальный Google Meet smoke обязателен. | Нужно от Meiirlan: показать импортированный run через текущий review/export.

REQUEST_CHANGE | session API | Для потоковой доставки и speaker timeline нужен согласованный `/api/sessions` из постановки, которого в main нет. Бот пока сохраняет FileSink и импортирует готовое аудио через существующий `POST /api/runs`; JSON сессии не выдумывается. | Потребитель: meet_bot.HttpSink | Совместимый переход: включить HttpSink только после публикации и smoke контракта.

Незакрыто: тестовый Google-аккаунт, ручной вход, реальная встреча двух говорящих на 3 минуты, проверка полноты аудио и явных speaker events; текущие селекторы Meet ещё не подтверждены. Docker с Xvfb не запускался. Текущий backend не хранит timeline бота. Автоматическое завершение при одиночестве зависит от доступности счётчика людей в UI.

Возможный compose-фрагмент после локального smoke (не применять автоматически):

```yaml
  meet-bot:
    build:
      context: .
      dockerfile: meet_bot/Dockerfile
    ports: ["127.0.0.1:8100:8100"]
    environment:
      BOT_PROFILE_DIR: /data/profile
      OUTPUT_DIR: /data/output
      API_BASE_URL: http://host.docker.internal:8000
    volumes:
      - ./meet_bot/.private:/data
    extra_hosts:
      - "host.docker.internal:host-gateway"
```

Профиль с cookies и записи остаются в локальном `meet_bot/.private`; не включать том в архив или git. Docker-сборка и вход в Google в контейнере не проверены.
