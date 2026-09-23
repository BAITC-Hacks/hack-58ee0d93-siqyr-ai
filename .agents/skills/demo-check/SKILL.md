---
name: demo-check
description: Use after deploys, before feature freeze and before submission. Verifies the demo path end to end.
---

1. Run scripts/demo_e2e.sh.
2. Request the deployed /api/health.
3. Spawn ui_tester on the deployed frontend following docs/DEMO.md.
4. Test DEMO_MODE=replay.
5. Report pass/fail with fixes ranked by demo impact.
