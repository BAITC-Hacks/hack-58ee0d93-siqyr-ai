---
name: synthetic-data
description: Use when the team needs eval cases, demo seed data or realistic meeting transcripts.
---

1. Labels (assignee, task, deadline) are decided in code first.
2. One call per combination of a parameter grid (language ru/kk/mixed, number of speakers, number of assignments, deadline phrasing).
3. MODEL_FAST with structured outputs; async with a concurrency limit of 10.
4. Obviously fake names and IDs; dedupe; validate business rules (deadline after meeting date, assignee is a participant).
5. A human reads 10 samples.
6. Output to data/synthetic/*.jsonl with a note on model and prompt. Label everything synthetic.
7. Eval cases are never reused as few-shot examples. Use a DEV key only.
