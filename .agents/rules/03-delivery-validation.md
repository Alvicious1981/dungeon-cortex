# Rule: Deliver in Small, Verifiable Slices

## Delivery format

For meaningful work, structure output as:

1. Baseline findings
2. Proposed slice
3. Files to change
4. Risks / assumptions
5. Validation plan
6. Result / residual issues

## Implementation policy

- Prefer the smallest useful slice that moves the product forward.
- Preserve existing working behavior unless the user explicitly requests a replacement.
- Do not run broad rewrites when a localized change can achieve the goal.
- Explicitly call out assumptions before relying on them.

## Validation requirements

Do not claim success until at least one of the following is true:

- tests pass;
- a build passes;
- lint/typecheck passes;
- runtime verification was performed;
- a limitation was stated honestly.

## Done definition

A task is only done when:

- the requested behavior is implemented or clearly narrowed;
- obvious regressions have been checked;
- touched files are listed;
- remaining risk is stated.
