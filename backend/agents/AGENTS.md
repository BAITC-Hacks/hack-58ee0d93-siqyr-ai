# backend/agents — Alibi (AI)

- Следуй скиллу $agents-sdk-patterns.
- Сначала runner_mock.py, чтобы разблокировать API и фронт; runner.py — с теми же сигнатурами:
  `async def propose(run_input: RunInput, emit: Emit) -> Proposal`
  `async def execute(proposal: Proposal, emit: Emit) -> Result`
- Агенты работают только с текстом (RunInput.segments). STT и диаризация — в backend/stt.
- Текст от STT в нижнем регистре, без пунктуации, числа и даты словами. Нужны:
  нормализация сроков («жұмаға дейін», «до пятого октября») в ISO-даты относительно даты совещания,
  сопоставление SPEAKER_xx с участниками, очистка текста для протокола.
- LLM только через OpenAI-совместимый клиент с LLM_BASE_URL (закрытый контур: vLLM + gpt-oss). Ключи и имена моделей — из env.
- Промпты — в prompts/*.md, вход на русском, казахском и смешанном.
- needs_approval и final эмитит бэкенд, не раннер.
- Точность и стоимость прогона — в docs/STATUS.md.
