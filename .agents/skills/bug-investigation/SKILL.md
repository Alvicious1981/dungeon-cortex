# Bug Investigation

Use this skill for runtime bugs, regressions, broken flows, or suspicious behavior.

## Goal

Find the smallest credible root cause, fix it safely, and prove what changed.

## Procedure

1. Restate the bug in concrete terms.
2. Identify the execution path and files involved.
3. Separate symptoms from root cause candidates.
4. Prefer reproducing the issue before changing code.
5. Apply the smallest fix that addresses the likely root cause.
6. Validate both the fix and nearby regression risk.

## Required output

### Bug statement
### Reproduction status
### Root cause
### Fix summary
### Files changed
### Validation
### Remaining uncertainty

## Constraints

- Do not present a guess as a confirmed root cause.
- Do not over-refactor under the label of a bug fix.
- If the issue spans multiple layers, map the chain clearly.
