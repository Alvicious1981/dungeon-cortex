# Feature Slice Delivery

Use this skill for adding or extending a feature in controlled increments.

## Goal

Implement one narrowly scoped, testable slice that improves the product without destabilizing the rest of the system.

## Slice design rules

A good slice should:
- solve one user-visible problem;
- touch the minimum number of subsystems needed;
- have explicit validation criteria;
- avoid speculative future-proofing.

## Execution sequence

1. Read `/PROJECT_CONTEXT.md`.
2. Confirm the current baseline from code.
3. Define the smallest valid slice.
4. List files likely to change.
5. Implement the slice.
6. Run the smallest meaningful validation set.
7. Report results and remaining risk.

## Output template

### Slice objective
### Scope included
### Scope intentionally excluded
### Files touched
### Validation performed
### Residual risk
### Suggested next slice

## Constraints

- Do not silently broaden scope.
- Do not bundle polish, refactor, and new features into one change unless required.
- If architecture drift is discovered mid-task, stop and reframe the slice.
