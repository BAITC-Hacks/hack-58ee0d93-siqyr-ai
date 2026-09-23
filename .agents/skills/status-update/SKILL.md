---
name: status-update
description: Use when a task is finished and must be recorded and shared. Runs tests, appends to docs/STATUS.md and docs/AI_USAGE.md, commits and pushes the current branch. Not for mid-task use.
---

1. Run the test/build commands from docs/STACK.md for the changed area (default: `pytest` for backend, `pnpm build` for frontend). Stop and report on failure.
2. Append `- [HH:MM] <name> done: ... | next: ... | gotchas: ...` to docs/STATUS.md (Astana time).
3. Append one line to docs/AI_USAGE.md: what Codex did, what the human verified.
4. `git add -A`; confirm no `.env`, `*.db` or real recordings are staged; conventional commit; `git pull --rebase`; `git push`.
