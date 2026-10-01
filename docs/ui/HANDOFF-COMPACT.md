# HANDOFF — DUNGEON CORTEX — UI-XX (compact)

Use for a normal, successful task completion. For any Stop Rule, failed verification, unresolved risk or context
transfer, use [HANDOFF-EXTENDED.md](HANDOFF-EXTENDED.md) instead. See [UI-WORKFLOW.md](UI-WORKFLOW.md).

```markdown
# HANDOFF — DUNGEON CORTEX — UI-XX

## STATUS
READY FOR REVIEW

## TASK
UI-XX — <name>

## BRANCH
<branch>

## BASE
origin/master @ <sha>

## HEAD
<sha>

## CHANGES
- ...

## TESTS
- `pnpm exec vitest run --maxWorkers=2 <paths>` → PASS (<n> tests run)
- `pnpm typecheck` → PASS
- `pnpm build` → PASS | NOT RUN — reason
- `pnpm lint` → PASS | NOT RUN — reason

## E2E
<PASS (AGENTS.md runbook, disposable database) | NOT RUN — reason>

## PR
<number/url | NOT CREATED>

## RISKS
<none | list>

## WORKING TREE
<clean | exact state>

## NEXT EXACT ACTION
Human review + CI verification. Do not start UI-(XX+1) until this PR is integrated in `origin/master`.

## NEW SESSION ALLOWED
YES

## SAFETY
NO MERGE PERFORMED
```
