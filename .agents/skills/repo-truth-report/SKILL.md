# Repo Truth Report

Use this skill whenever the repository has not yet been audited, or when the user asks how to continue from the current project state.

## Goal

Convert an unknown or partially known repository into an explicit baseline before proposing architecture changes or implementation work.

## Procedure

1. Read `/PROJECT_CONTEXT.md`.
2. Inspect repository structure.
3. Identify actual stack, entry points, data layer, AI orchestration layer, and test/build commands.
4. Compare repository reality against the project context.
5. Produce a concise truth report.

## Required output

Return these sections:

### 1. What exists
- implemented subsystems
- relevant files/folders
- major dependencies actually present

### 2. What is missing
- expected P0/P1 systems absent from code
- important docs/config gaps

### 3. What is broken or suspicious
- failing or likely failing paths
- dead references
- placeholder logic
- mismatched architecture assumptions

### 4. Baseline recommendation
- the next safest slice to work on
- Planning or Fast recommendation
- validation steps needed before implementation

## Rules

- Prefer evidence from code and runnable commands over comments.
- Distinguish verified facts from reasonable inferences.
- Keep the report concise and decision-oriented.
- Never say “done” for a subsystem unless verification supports it.
