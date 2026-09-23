# Frontend handoff

- По запросу пользователя интерфейс переведён с Inter на локальный Geist Variable (шрифт Vercel) для более выразительной типографики в стиле крупных технологических продуктов.
- `@fontsource-variable/geist` подключён через npm; `@fontsource/inter` удалён. Шрифт используется в базовом CSS и теме Mantine, включая заголовки. Внешний CDN не требуется.
- Проверено: `npm run build`; в сборке есть WOFF2 для Latin, Cyrillic и Cyrillic Extended. Существующие изменения экранов и маршрутов не затрагивались.
