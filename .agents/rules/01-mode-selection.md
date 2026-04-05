# Rule: Select the Right Operating Mode

Choose operating style based on task risk and scope.

## Use Planning mode when

- the repository has not yet been audited;
- the task touches architecture, data flow, persistence, AI orchestration, or combat logic;
- the task spans multiple files or subsystems;
- the task is ambiguous, risky, or likely to require validation steps;
- the user asks for research, adaptation, or strategy.

## Use Fast mode when

- the task is localized and low risk;
- the change is mostly mechanical;
- success criteria are explicit;
- blast radius is small.

## Additional policy

- Default to Planning until the repo truth report exists.
- After Planning produces a clear slice, implementation can switch to Fast for narrow edits.
- If Fast uncovers uncertainty, immediately return to Planning behavior.
