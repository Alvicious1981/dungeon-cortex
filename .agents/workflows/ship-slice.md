---
description: Define and implement one safe feature slice aligned with PROJECT_CONTEXT.md
---

When the user types `/ship-slice <goal>`, do the following:

1. Read `PROJECT_CONTEXT.md` and `.agents/agents.md`.
2. If no repo truth report exists yet, run the equivalent of `/truthcheck` first.
3. Reframe `<goal>` as the smallest verifiable slice.
4. Choose Planning or Fast according to `.agents/rules/01-mode-selection.md`.
5. Use `feature-slice-delivery`.
6. If gameplay-critical state is affected, also use `rules-engine-integrity`.
7. Implement only the agreed slice.
8. Validate using the smallest meaningful command set.
9. Report:
   - slice objective
   - files changed
   - validation performed
   - residual risk
   - next suggested slice
