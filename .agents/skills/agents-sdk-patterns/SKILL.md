---
name: agents-sdk-patterns
description: Use when writing or changing agents in backend/agents/. OpenAI Agents SDK patterns for this repo.
---

- Model names only from env (MODEL_MAIN, MODEL_FAST, MODEL_EXPERT). The LLM client uses LLM_BASE_URL (OpenAI-compatible; self-hosted vLLM + gpt-oss for the closed contour).
- runner.py and runner_mock.py expose identical `propose(run_input, emit)` and `execute(proposal, emit)`.
- Every agent start, tool call, tool result and handoff calls `emit(StepEvent)`. needs_approval and final are emitted by the backend.
- Errors emit `type=error` instead of crashing.
- Specialist agents attach to the orchestrator as tools (`agent.as_tool`): speaker_mapper, assignment_extractor, summarizer, notifier.
- Structured outputs use Pydantic output types from backend/shared/schemas.py.
- Input guardrails reject empty or unsafe input.
- Human approval always sits between propose and execute.
- Prompts live in backend/agents/prompts/*.md and handle Russian, Kazakh and mixed input. STT text is lowercase, unpunctuated, numbers and dates as words: normalize deadlines to ISO dates relative to meeting_date with a tool.
- Before using an unfamiliar SDK feature or model parameter, ask docs_researcher.
