# Codex Workflow — Dungeon Cortex

This guide explains how to use Codex with Dungeon Cortex in a controlled and reviewable way.

## Goal

Use Codex for focused engineering tasks with clear scope, validation, and final reporting.

## Before starting

Prepare:

1. A clear task.
2. The allowed area of the repository.
3. The expected validation command.
4. Any files or folders that should stay unchanged.

## Recommended first prompt for Codex

```text
Read AGENTS.md, docs/DECISION_5E_SRD_API.md, MASTER_ARCH_GUIDE.md, PROJECT_CONTEXT.md, and package.json. Then inspect the relevant code and produce a truth check before proposing edits. Do not change files yet.
```

## Good task structure

A good Codex task should say:

1. What needs to change.
2. Why it needs to change.
3. Which area is allowed to change.
4. Which validation command must pass.

Example:

```text
Fix the combat consequence rendering bug. Stay within components/combat and lib/events unless you find a documented contract mismatch. Run pnpm typecheck and relevant tests before reporting completion.
```

## Prompt templates

### Documentation task

```text
Read AGENTS.md and the documentation files relevant to this task. Audit the requested docs for accuracy, consistency, navigability, and clarity. Do not edit files until you provide findings and an implementation plan.
```

### Small bug fix

```text
Read AGENTS.md and inspect the relevant code. Identify the smallest safe fix. Do not change unrelated files. Run pnpm typecheck and the most relevant test before reporting completion.
```

### Backend rules task

```text
Read AGENTS.md, docs/DECISION_5E_SRD_API.md, MASTER_ARCH_GUIDE.md, and relevant rule modules. Preserve backend mechanical authority and D&D 5e/SRD 2014 canon. Propose a plan before edits.
```

### API or event-contract task

```text
Read AGENTS.md, docs/API.md, MASTER_ARCH_GUIDE.md, lib/events/game-events.ts, and the relevant route or consumer. Identify the current contract before proposing edits. Run pnpm typecheck and pnpm build when appropriate.
```

### QA review

```text
Review the recent changes against AGENTS.md, package.json scripts, and the relevant source-of-truth docs. Report risks, missing tests, and any documentation-code drift. Do not edit files.
```

## When to use a new Codex task

Start a new task when:

- the topic changes,
- the previous task became long,
- several attempts failed,
- you move from audit to implementation,
- you move from implementation to QA,
- you want an independent review.

## Review checklist

Before accepting changes, check that Codex reports:

- files changed,
- what changed,
- validation commands run,
- whether validation passed,
- remaining risk,
- any skipped validation and why.

## Validation commands

For TypeScript or shared contracts:

```bash
pnpm typecheck
```

For rules, backend, or utilities:

```bash
pnpm exec vitest run --maxWorkers=2
```

For broad app changes:

```bash
pnpm build
```

For UI or end-to-end flows:

```bash
pnpm test:e2e
```

For D&D rules-canon or terminology changes:

```bash
pnpm check-retro
```

## If validation fails

Ask Codex to report:

1. The command that failed.
2. The short error summary.
3. The likely cause.
4. The smallest next fix.
5. Whether a new task would be cleaner.

## Development agent setup

The project's main Codex session is the orchestrator: `gpt-5.6-sol` with `high` reasoning. `.codex/config.toml` sets this default and limits concurrently open spawned threads to three, excluding the primary session. Custom agents are standalone TOML files in `.codex/agents/`, with required `name`, `description`, and `developer_instructions` fields.

| Agent name | Model | Reasoning | File sandbox | Use |
| --- | --- | --- | --- | --- |
| `explorador` | `gpt-6-luna` | `medium` | Read-only | Trace live code paths and tests. |
| `implementador` | `gpt-6-luna` | `high` | Workspace write | Small, clearly specified changes. |
| `documentacion` | `gpt-6-luna` | `medium` | Workspace write | Documentation grounded in implementation. |
| `revisor_critico` | `gpt-5.6-sol` | `high` | Read-only | Independent review of critical changes. |

The main agent handles simple tasks directly. It delegates when independent work or focused investigation justifies the extra token usage. Ambiguous rules, combat, persistence, concurrency, schema, or event-contract work stays with the main agent; authorized changes in these areas receive independent critical review. Subagents do not spawn another layer.

### Activate the configuration

1. Open a checkout containing these files in a current local Codex client that supports standalone custom agents and the `agents` configuration keys.
2. Mark the project as trusted after reviewing its configuration. Untrusted project configuration may be ignored.
3. Confirm your signed-in account or workspace has access to both configured models. Configuration does not grant model access. If a model or role is unavailable, report it and explicitly choose an available replacement; avoid silent fallback.
4. Start a new session in this checkout and confirm the effective main model and reasoning effort. User settings, command-line options, UI choices, and runtime overrides can take precedence.
5. Check that all four named roles are discoverable and that their effective model, reasoning, permissions, and MCP settings match their files.

Every custom role disables the existing Supabase MCP server and further delegation. The main session retains the existing Supabase server configuration and the repository's restrictions on database operations. File `read-only` mode alone does not constrain MCP access, and workspace-write mode does not enforce assigned-file ownership; verify effective tool access and follow the ownership policy in `AGENTS.md`. Runtime permission overrides may change sandbox defaults.

### Read-only smoke check

Use a new session with a bounded task such as:

```text
Use the explorador custom agent to trace where narrator tools are selected.
Then have revisor_critico independently check that trace.
Read files only; do not edit files, connect to any database, run setup, or change Git state.
Wait for both results and report file/symbol evidence and any configuration limitations.
```

Inspect both subagent threads in the client's agent view. Confirm each configured model and reasoning effort was selected, both agents remained read-only, neither had Supabase access, and neither spawned children. This verifies role loading and read-only delegation; it does not exercise the writer roles or prove application tests pass. Treat the setup as unverified until this check runs in the target client.

### Dispatch and completion

Each dispatch includes the goal, relevant context and decisions, assigned files, acceptance criteria, allowed checks, and a concise return-report requirement. Run independent reads or disjoint-file edits in parallel. Sequence dependent changes and use one writer per file. On ambiguity, scope expansion, or repeated failure, return to the main agent rather than launching more retries.

Subagents return evidence, changes, validation actually run, results, uncertainty, and whether work continues. The main agent inspects their diffs, integrates the work, and runs the smallest relevant final checks from `AGENTS.md`.

The thread limit is a concurrency control, not a token or spending budget. Each subagent consumes additional tokens; use fewer agents for small tasks and review actual account usage before claiming savings. This setup configures development work and does not alter the in-game narrator.

Configuration reference: [Codex subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents).

## Final report template

Ask Codex to finish each task with:

```text
Files changed:
- ...

What changed:
- ...

Validation run:
- ...

Result:
- Passed / Failed / Not run

Remaining risk:
- ...

Recommended next step:
- ...
```
