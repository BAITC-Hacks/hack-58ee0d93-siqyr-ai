---
name: contract-guard
description: Use before changing any endpoint, event or shared schema, or when frontend/backend/agents/stt integration breaks. Compares code with docs/CONTRACT.md and backend/shared/schemas.py.
---

1. List every mismatch (paths, field names, event types, status values, SSE event names) with file references.
2. Never silently change the contract.
3. If a change is needed, draft a docs/DECISIONS.md entry and ask the human who must agree (Meiirlan owns CONTRACT.md; schemas.py is Meiirlan + Alibi).
