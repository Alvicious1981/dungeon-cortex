# HANDOFF — DUNGEON CORTEX — UI-XX (extended)

Use for any Stop Rule, failed verification, unresolved risk, blocked work or context transfer. For a normal successful
completion use [HANDOFF-COMPACT.md](HANDOFF-COMPACT.md). See [UI-WORKFLOW.md](UI-WORKFLOW.md) §9–§10.

```markdown
# HANDOFF — DUNGEON CORTEX — UI-XX

## STATUS
<IN PROGRESS | BLOCKED | CONTEXT HANDOFF | TEST FAILURE | READY FOR REVIEW>

## STOP CODE
<STOP-...>

## STOP REASON
<precise reason>

## TASK
UI-XX — <name>

## REPOSITORY
`Alvicious1981/dungeon-cortex`

## LOCAL SESSION / WORKTREE
<path or identifier if known>

## BRANCH
<branch>

## GIT STATE

Local HEAD:
`<sha>`

origin/master:
`<sha>`

Starting/base SHA:
`<sha>`

Working tree:
<git status --short>

Diff stat:
<git diff --stat>

## OBJECTIVE
<exact task objective>

## COMPLETED
- ...

## NOT COMPLETED
- ...

## FILES CHANGED
- `path`
  - ...

## IMPORTANT DECISIONS
- ...

## DOMAIN / SCOPE BOUNDARIES
- ...

## TESTS EXECUTED

### `<command>`
Result: PASS / FAIL
Evidence: ... (for vitest, state how many tests ran, not only the colour)

## CURRENT FAILURE
<exact useful evidence>

## FAILED APPROACHES

### Attempt 1
- approach:
- result:
- why not repeat without new evidence:

### Attempt 2
- approach:
- result:
- why not repeat without new evidence:

## RISKS / OPEN QUESTIONS
- ...

## PR
<number/url | NOT CREATED>

## COMMIT STATE
<committed | uncommitted | mixed>

Latest valid task commit:
`<sha | N/A>`

## SAFE ROLLBACK REFERENCE
`<last known good sha>`

Do not roll back automatically.

## NEW SESSION ALLOWED
<YES | NO>

Use `NO` when important uncommitted work exists only in this worktree and cannot safely be reconstructed from Git.

## EXACT NEXT STEP
<one concrete next action>

## NEXT SESSION INSTRUCTIONS

1. Re-run the full preflight (`docs/ui/UI-WORKFLOW.md` §5, gate 1).
2. Verify this handoff against Git and `origin/master`. Git is the authority.
3. Inspect `git status` and `git diff`.
4. Re-read modified files.
5. Reproduce the most relevant last test when possible.
6. Confirm scope before editing.
7. Do not repeat failed approaches without new evidence.
8. Do not merge.

## SAFETY
NO MERGE PERFORMED
```
