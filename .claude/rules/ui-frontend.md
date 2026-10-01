---
paths:
  - "components/**/*.tsx"
  - "app/**/*.tsx"
  - "app/globals.css"
  - "tests/components/**"
---

# UI frontend rules — Dungeon Cortex

Path-scoped companion to `AGENTS.md`, `docs/UI_SPEC.md` and `docs/DESIGN.md`. It covers UI concerns only and never
repeats or overrides `AGENTS.md`; if they differ, `AGENTS.md` and the content authorities win.

## Read first

- `docs/UI_SPEC.md` for requirements, states, responsive matrix and accessibility.
- `docs/DESIGN.md` and `app/globals.css` for the visual system.
- For a UI-01 → UI-10 task, `docs/ui/UI-WORKFLOW.md` and the active `docs/ui/tasks/UI-XX.md`.

## Rules

- **Tokens.** Use the semantic `--dc-*` tokens from `app/globals.css`. Keep a domain-specific colour only when no semantic
  token fits, and say why.
- **Reuse.** Use `components/ui/Button.tsx`, `Panel.tsx` and `StatusMessage.tsx` before building a parallel control. Do not
  start a second UI implementation of something that already exists.
- **Targets.** Interactive targets are at least 44×44 px.
- **Keyboard.** Everything is operable from the keyboard, in a logical DOM order. Global shortcuts must stay ignored in
  text-entry controls and behind open dialogs, as `components/combat/CombatHUD.tsx` already does. Do not add a second
  listener for a shortcut that exists.
- **Focus.** Keep a visible `focus-visible` style with sufficient contrast.
- **Motion.** Short, `transform`/`opacity` only where viable, and none of it under `prefers-reduced-motion: reduce`.
  No typewriter text and no transition that delays data. Do not add a motion library.
- **No colour-only state.** Selected, disabled, invalid, success and error also carry text, a label or an icon with a
  text alternative. Mechanical values are text, not only a gauge.
- **Drag and drop** is never the only way to do something essential. Provide select → choose destination → confirm.
- **States.** Async surfaces cover idle, loading, confirmed success, empty, recoverable error, unrecoverable error,
  degraded connection and unavailable-with-reason (`UI_SPEC` §5).
- **Copy.** Interface text is Spanish; mechanical messages are direct; an error says what happened and what to do.
- **Authority.** The UI presents domain state and sends intent to existing contracts. It does not compute AC, attunement,
  rests, inventory legality, resource eligibility, FOV or combat results, and it reads consequences from `targets[]`.
  A component receives resolved state and callbacks; it does not invent an API, a persisted field or a rule. If the data a
  design needs does not exist, build a controlled presentational contract with a fallback, or stop and report.
- **Responsive.** No horizontal document overflow at 390×844, 768×1024, 1024×768 and 1440×900.
