---
description: Audit the repository against PROJECT_CONTEXT.md and produce a concise repo truth report
---

When the user types `/truthcheck`, do the following:

1. Read `PROJECT_CONTEXT.md` and `.agents/agents.md`.
2. Inspect the repository to determine actual stack, entry points, persistence layer, AI orchestration, and validation commands.
3. Use the `repo-truth-report` skill.
4. Produce a concise report with these sections:
   - What exists
   - What is missing
   - What is broken or suspicious
   - Mismatches with PROJECT_CONTEXT.md
   - Recommended next slice
   - Recommended mode: Planning or Fast
5. Do not propose a large implementation until the report is complete.
