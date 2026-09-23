# SiqyrAI

Локальное рабочее пространство для встреч, протоколов и поручений. React + TypeScript + Mantine, TanStack Query для асинхронных данных, Dexie для IndexedDB и Axios для будущих API-адаптеров.

```sh
npm ci
cp .env.example .env.local
npm run dev
```

Нужен Node.js 22.18+ (тесты используют встроенное выполнение TypeScript). Перед входом запустите API в режиме `AUTH_MODE=local`. Vite запускается на `http://127.0.0.1:5174`.

```sh
npm run check             # границы архитектуры, типы, тесты и production build
npm test                  # домен, IndexedDB, Query, HTTP и запись
npm run check:architecture
```

## Структура

```text
src/
  app/                      # сборка приложения и конкретных зависимостей
    composition/            # фабрики сервисов и HTTP-клиента
    providers/              # QueryClient, Mantine, WorkspaceProvider
    routing/                # маршруты и lazy loading
    layout/                 # оболочка приложения
    styles/                 # тема и глобальные стили
  modules/
    meetings/
      domain/               # модели, команды, правила встречи и источника
      application/          # MeetingService и интерфейсы адаптеров
      infrastructure/       # печать и лениво загружаемый DOCX
      presentation/
        models/             # состояние форм и сценарии экранов
        pages/              # JSX и CSS рядом
    tasks/                  # TaskRecord, TaskBoard, TaskService и UI
    settings/               # настройки, валидация и UI
    recording/              # Recorder, BrowserRecorder и React hooks
    workspace/              # общий снимок, DI context, Query keys/options
  infrastructure/
    persistence/            # схема Dexie, репозитории, демонстрационные данные
    http/                   # AxiosHttpClient
  shared/
    domain/                 # ошибки домена, локальные даты, генератор ID/времени
    application/            # HTTP-контракт и HttpError
    lib/                    # общие чистые функции
    presentation/           # общие React hooks
```

Детали и путь подключения бэкенда: [docs/architecture.md](docs/architecture.md).

Страница входа, защищённые маршруты и настройка будущих правил ролей/прав: [docs/frontend-auth.md](docs/frontend-auth.md). Конфигурация доступа централизована в `src/app/routing/access.ts`.

## API

Авторизация подключена к API: укажите публичный `VITE_API_URL` из `.env.example`, например `http://127.0.0.1:8000`, и запустите бэкенд с `AUTH_MODE=local`. Форма отправляет логин и пароль в `/api/auth/login`, хранит JWT в `sessionStorage` текущей вкладки и проверяет его через `/api/auth/me` после перезагрузки. Выход удаляет токен из вкладки. ЭЦП и Keycloak недоступны в UI до настройки корпоративных сервисов.

Роль берётся из `departments` ответа `/api/auth/me` для департамента `default`: UI создаёт встречи без `department_id`, и API относит их к нему. Права повторяют серверные (`src/modules/auth/domain/departmentAccess.ts`): `viewer` только читает, `editor` и выше создают встречи и разговоры, `secretary` и выше утверждают, системный администратор может всё. Без права записи страницы `/meetings/new` и `/meetings/live/call` закрыты, а кнопки к ним скрыты. Роль видна в меню профиля. Сервер проверяет каждый запрос сам, UI только не предлагает запрещённое.

`AxiosHttpClient` обеспечивает таймаут 30 секунд, `AbortSignal`, параметры запроса, типизированный ответ и `HttpError`.

Данные встреч и поручений по-прежнему сохраняются в IndexedDB браузера: они разделены по ID пользователя на этом устройстве, но не синхронизируются с сервером. Для серверных данных нужны API-репозитории в `app/composition/createServices.ts`.
