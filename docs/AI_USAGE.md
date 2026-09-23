# AI_USAGE

Этот раздел отделяет сделанное от планируемого. Перед сдачей команда заменяет планы фактическими результатами и ссылками на commits/eval, без ключей или содержимого приватных встреч.

| Компонент | Подтверждено сейчас | Что нужно зафиксировать к сдаче |
|---|---|---|
| STT Alibi | Собственная модель до хакатона; greedy test на 480.28 с predominantly RU | Hash весов, runtime, новые KK/mixed прогоны, ограничения |
| Codex | Чтение требований, анализ состояния и разработка execution-плана | Вклад в реализацию по git; человек проверяет code/результаты |
| OpenAI API | Команда разрешила начальную synthetic-dev фазу, $50 на ключ | Actual model ID, выдуманные inputs/provenance, tokens/cost, что проверил человек; пока вызовы в рамках плана не выполнялись |
| Local LLM | Выбраны qwen3:4b/1.7b, ещё нужен smoke | Actual provider/model digest/latency, same-contract switch, offline proof |
| NVIDIA Brev | Авторизован и настроен по сообщению команды; $50 | GPU/VRAM/rate, синтетические experiments и actual spend; право обработки исходных встреч не установлено |

Обещание OpenAI «не обучать на API данных» не делает внешний API локальным. Использование OpenAI-compatible API не равно использованию hosted OpenAI. Вопрос зачёта synthetic-dev сценария организаторам ещё открыт. Официальные источники: [GPT-4.1 mini](https://developers.openai.com/api/docs/models/gpt-4.1-mini), [gpt-oss local](https://developers.openai.com/cookbook/articles/gpt-oss/run-locally-ollama), [данные API](https://developers.openai.com/api/docs/guides/your-data).

- [14:05] Codex подготовил и проверил execution-документы; docs_researcher сверил официальные сведения OpenAI. Пользователь подтвердил M3 Pro, готовый Brev, бюджеты и этап OpenAI→local. Человек ещё не подтвердил аудио-эталон, runtime-метрики или трактовку правил; они не представлены как выполненные.

- [13:59] Codex: объединил истории frontend/main в отдельной рабочей копии, разместил приложение в frontend/, обновил инструкции и проверил сборку. Проверка человеком: ожидается review PR; новые ручные проверки не заявляются.
