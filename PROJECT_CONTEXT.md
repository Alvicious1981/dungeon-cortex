---
title: Dungeon Cortex — Project Context & Source of Truth
version: 1.0
adapted_from: dungeon-cortex-tdd-v4.md
adapted_on: 2026-03-29
intended_location: project-root/PROJECT_CONTEXT.md
purpose: Canonical project context for Google Antigravity Agent Manager and Editor agents.
status: Planning baseline for a greenfield or partially-built project.
---

# Dungeon Cortex — Project Context & Source of Truth

## 1. How this file must be used

This document is the canonical working context for Antigravity agents operating on Dungeon Cortex.

The agent must:
1. Read this file before proposing architecture changes, major refactors, or multi-file implementations.
2. Treat this file as the default source of truth for product intent, architecture, priorities, guardrails, and delivery standards.
3. Treat the original TDD as a reference archive, not as the operational contract.
4. Never assume a feature is already implemented just because it appears in the original TDD with a checkmark.
5. Verify actual implementation state in code before claiming completion.

### Precedence order

When instructions conflict, resolve in this order:
1. Explicit user instruction in the current conversation.
2. This file.
3. Narrower project rules/skills in `.agents/`.
4. Historical TDDs, notes, or speculative design text.
5. Agent preference.

---

## 2. Why this file exists

The original `dungeon-cortex-tdd-v4.md` is strong as a product and technical vision, but it is too broad and too implementation-heavy to act as an efficient operating brief for Antigravity.

This adapted version is optimized for agentic development:
- less reference code, more durable decisions;
- less speculative detail, more execution guardrails;
- clear product intent;
- clear architecture constraints;
- clear scope priorities;
- clear validation rules;
- explicit uncertainty handling.

---

## 3. Product identity

**Project name:** Dungeon Cortex

**Product type:** Single-player AI Dungeon Master web application inspired by tabletop Dungeons & Dragons.

**Core promise:**
A player can create a character, enter a campaign quickly, interact with an AI Dungeon Master, and experience deterministic rules-backed play with stronger immersion than a plain chat interface.

### Non-negotiable design pillars

1. **Code is Law**
   The AI may narrate, but game rules and state transitions must be validated by code.

2. **Single-player first**
   The product is not multiplayer-first. Any feature that adds multiplayer complexity is lower priority unless explicitly requested by the user.

3. **Diegetic immersion**
   UI and feedback should reinforce the fiction: damage, conditions, spellcasting, battle state, ambient context, and memory should feel in-world whenever practical.

4. **Fast time-to-fun**
   The path from first launch to first meaningful session must be short.

5. **Incremental trust**
   The AI must not fake game-state validity, hidden calculations, persistence, or feature completion.

---

## 4. Current project-state assumptions

Unless the codebase proves otherwise, Antigravity must assume the following:

- This project may still be **greenfield**, **partial**, or **prototype-only**.
- The original TDD describes the **target architecture**, not guaranteed reality.
- The first engineering duty is to determine **what actually exists**.
- No roadmap phase is “done” until validated in the repository.

### Required first move on an existing repo

Before major changes, the agent should produce a short repository truth report:
- what exists;
- what is missing;
- what is broken;
- what differs from this document;
- what should be treated as current baseline.

---

## 5. Product scope

### P0: must exist in the first solid playable version

1. Character creation
2. Campaign/session start
3. Narrative chat loop with streaming
4. Rules-backed checks and combat resolution
5. Persistent player/campaign state
6. Basic inventory and spell support
7. Minimum viable combat UI
8. Error-safe save/load path

### P1: high-value immersion layer

1. Initiative tracker
2. Dice presentation
3. Audio cues / ambience
4. Quest journal and NPC memory
5. Mobile-friendly layout
6. Accessibility foundations

### P2: polish and advanced immersion

1. Tactical battle map
2. TTS narration
3. Rich settings and preferences
4. Analytics/monitoring
5. Extended visual flourish

### Explicit out-of-scope by default

Do not expand into these areas unless the user explicitly asks:
- multiplayer or co-op systems;
- live GM tools for several players;
- overly complex 3D environments;
- premature microservice decomposition;
- speculative AI subsystems that do not improve the core loop.

---

## 6. Canonical user experience goals

The intended primary loop is:
1. Create character.
2. Enter world.
3. Receive narrative situation.
4. Choose action in natural language.
5. System validates rules in code.
6. Results are narrated with clear state updates.
7. Session state persists reliably.

### UX success criteria

- First playable session should begin quickly.
- Combat should feel readable, not confusing.
- The player should always understand:
  - whose turn it is,
  - what changed,
  - why a result happened,
  - what the next meaningful action is.

### UX anti-goals

Avoid:
- dense unreadable interfaces;
- over-animated UI that obscures state;
- “beautiful but fake” features with no real logic behind them;
- verbose AI narration that blocks player agency.

---

## 7. Approved architecture baseline

### Primary stack

Unless the user changes direction, the default target stack remains:
- **Next.js 15**
- **Vercel AI SDK**
- **PostgreSQL**
- **pgvector** for memory retrieval
- **D&D 5e API** as structured rules/content source

### Architectural principle

Narrative generation, rules validation, persistence, and presentation are separate concerns.

### Conceptual subsystems

1. **Narrative layer**
   Produces story text, scene framing, and player-facing narration.

2. **Rules layer**
   Validates mechanics, checks conditions, applies deterministic outcomes, and mutates game state.

3. **World/state layer**
   Persists character, campaign, encounter, inventory, quests, NPCs, and logs.

4. **Presentation layer**
   UI panels, combat widgets, effects, audio, accessibility, and mobile views.

5. **Memory layer**
   Episodic recall, quest tracking, NPC continuity, and campaign summaries.

### Important architectural guardrails

- Prefer a **modular monolith** over premature service splitting.
- Keep rules evaluation deterministic and auditable.
- Prefer server-owned truth for campaign-critical state.
- Use the AI to interpret intent and narrate, not to own the canonical rules engine.
- Avoid introducing extra providers or APIs unless they serve a clear validated need.

---

## 8. Core domain entities

These entities are foundational and should remain stable unless a migration is justified:

- Character
- Campaign
- InventoryItem
- CombatEncounter
- Combatant
- Quest
- NPC
- Session
- GameLog
- UserPreference
- APICache

### Required invariants

- A campaign belongs to one user and one active player character.
- Combat state must be resumable.
- Inventory and spells affect real mechanics, not just display.
- Memory records must be queryable and attributable to a campaign.
- User preferences must never corrupt core gameplay state.

---

## 9. Rules and game-state philosophy

### Mandatory rule

When a player action has gameplay consequences, the system must separate:
- **intent parsing**;
- **rules validation**;
- **state mutation**;
- **player-facing narration**.

### The agent must never

- invent successful mechanics without validation;
- mark quests completed without state mutation;
- spend spell slots only in text but not in data;
- imply persistence if data was not saved;
- hide important failure states behind decorative narration.

### Preferred resolution model

For any consequential action:
1. detect action intent;
2. gather required data;
3. validate legality;
4. resolve mechanics;
5. persist state changes;
6. emit player-facing explanation and narrative.

---

## 10. Memory and continuity requirements

Memory is not optional decoration. It is a core differentiator.

### Minimum required memory behaviors

- campaign recap support;
- quest tracking;
- NPC recall;
- location/event recall;
- searchable session history;
- stable summaries for long-running campaigns.

### Memory quality rule

Prefer compact, high-signal memory over dumping entire chat logs into prompts.

### Retrieval rule

Use semantic retrieval to support continuity, but do not let retrieval silently override canonical state tables.

---

## 11. Combat requirements

Combat must be understandable before it is flashy.

### Must-have combat behaviors

- initiative order;
- current turn clarity;
- hit/miss transparency;
- damage application;
- condition visibility;
- encounter start/end state transitions;
- victory/defeat handling.

### Nice-to-have only after clarity is solved

- 3D dice;
- richer battle maps;
- screen effects;
- extra animation layers.

### Combat design rule

Readability beats spectacle.

---

## 12. Accessibility and mobile requirements

Accessibility and mobile support are first-class constraints, not post-launch decoration.

### Minimum commitments

- keyboard navigation for critical flows;
- screen-reader-friendly updates for important state changes;
- sufficient contrast modes;
- reduced-motion compatibility;
- responsive layout for core gameplay flows;
- touch-friendly controls where needed.

### Implementation rule

Do not ship UX effects that reduce clarity for accessibility users.

---

## 13. Delivery strategy for Antigravity

### Default execution philosophy

Antigravity should implement in small validated slices.

### Preferred sequence

1. repo audit / baseline truth
2. confirm architecture and folder map
3. establish playable core loop
4. add combat clarity
5. add persistence and memory
6. add spell/inventory depth
7. add immersion and polish
8. harden with tests, monitoring, and cleanup

### Required behavior on every non-trivial task

Before coding, the agent should briefly state:
- what it believes the current state is;
- what files it will touch;
- what risk exists;
- how it will validate success.

After coding, the agent should report:
- files changed;
- commands run;
- observed result;
- remaining risk or follow-up.

---

## 14. Planning mode vs Fast mode policy

### Use **Planning** mode when

- architecture is being decided;
- a feature touches multiple subsystems;
- repository understanding is incomplete;
- bugs are ambiguous;
- the task requires research, comparison, or sequencing.

### Use **Fast** mode when

- the task is tightly scoped;
- the affected files are already known;
- the change is local and low risk;
- the user wants quick iteration on a validated path.

### Default policy for this project

- Start in **Planning** for first contact with a repo, major features, refactors, debugging of unclear issues, and specification work.
- Switch to **Fast** only after the task is narrowed and acceptance criteria are clear.

---

## 15. Model-routing hints for Antigravity

These are recommendations, not rigid rules.

### Best-fit model guidance

- **Gemini 3.1 Pro / high**: architecture, multimodal reasoning, repo understanding, longer-horizon planning.
- **Gemini 3 Flash**: strong coding and multimodal iteration when speed matters.
- **Claude Sonnet 4.6 (thinking)**: daily coding, refactors, instruction following, deep codebase edits.
- **Claude Opus 4.6 (thinking)**: hardest reasoning, architecture trade-offs, difficult debugging.

### Practical default

If the task is implementation-heavy inside an existing codebase, prefer **Claude Sonnet 4.6** unless there is a strong reason to use a heavier model.

If the task is architecture-heavy or research-heavy, start with **Gemini 3.1 Pro** or **Claude Opus 4.6**.

---

## 16. Testing and validation policy

No meaningful task is complete without validation.

### Required validation ladder

1. static validation (types, lint, schema)
2. unit/integration tests where applicable
3. manual run for affected flow
4. agent summary of what was actually verified

### The agent must distinguish between

- **implemented but not tested**
- **tested locally**
- **verified end-to-end**

### Forbidden completion pattern

Do not say a feature is complete if the result was only reasoned about and not validated.

---

## 17. Error handling and resilience policy

The system should degrade gracefully.

### Minimum expectations

- reconnection and recovery paths for session transport failures;
- fallbacks for AI/tool failures;
- safe persistence boundaries;
- user-visible error states that preserve trust;
- logging that helps diagnosis without exposing secrets.

### Reliability rule

A graceful fallback is better than a broken cinematic feature.

---

## 18. Security and secrets policy

- Secrets must remain in environment variables or approved secret stores.
- Never hardcode API keys.
- Browser/web tooling must be used carefully; avoid broad unsafe browsing behavior.
- Any external integration must have a clear purpose and minimal privilege.

---

## 19. Performance policy

- Optimize for perceived responsiveness of the main play loop.
- Do not add heavy visual or audio layers before the core loop is stable.
- Prefer caching structured external content like rules data.
- Prefer concise prompts and modular skills over giant always-loaded instructions.

---

## 20. Folder conventions

### Recommended root files

- `PROJECT_CONTEXT.md` ← this file
- `README.md`
- `.env.example`

### Recommended Antigravity-native folder

- `.agents/agents.md`
- `.agents/rules/`
- `.agents/skills/`
- `.agents/workflows/`

### Important compatibility note

If the repository still uses `.agent/skills`, treat it as legacy-compatible, but prefer migrating toward `.agents/skills` unless the user wants strict backward compatibility.

---

## 21. Suggested repository shape

This is the target organization, not a guarantee of current reality:

```text
project-root/
├─ PROJECT_CONTEXT.md
├─ app/
├─ components/
├─ lib/
│  ├─ ai/
│  ├─ db/
│  ├─ dnd-api/
│  ├─ websocket/
│  ├─ audio/
│  └─ utils/
├─ public/
├─ prisma/
├─ scripts/
├─ tests/
└─ .agents/
   ├─ agents.md
   ├─ rules/
   ├─ skills/
   └─ workflows/
```

---

## 22. Roadmap, normalized for agent execution

### Milestone A — Playable foundation

Target outcome:
- character creation;
- narrative loop;
- persistence baseline;
- basic UI shell.

### Milestone B — Combat clarity

Target outcome:
- initiative;
- encounter resolution;
- readable combat feedback;
- rules-backed turn flow.

### Milestone C — Magic and state depth

Target outcome:
- spells;
- inventory meaningfully connected to mechanics;
- progression baseline.

### Milestone D — Memory and continuity

Target outcome:
- journal;
- NPC memory;
- quest continuity;
- searchable recall.

### Milestone E — Immersion and accessibility

Target outcome:
- audio;
- enhanced UI feedback;
- mobile polish;
- accessibility hardening.

### Milestone F — Production hardening

Target outcome:
- test coverage growth;
- monitoring;
- error handling;
- performance cleanup;
- release readiness.

---

## 23. Decisions already approved

Unless the user changes direction, assume these are approved:

- single-player first;
- deterministic rules validation;
- diegetic UI as a style goal, not a license for unreadability;
- Next.js + Vercel AI SDK + PostgreSQL baseline;
- D&D 5e API as a structured content source;
- memory and persistence are part of the product core;
- modular monolith over premature services.

---

## 24. Open questions the agent should surface instead of guessing

Raise, do not guess, when these materially affect implementation:

- Which AI provider/model should own the primary runtime path?
- Is image generation part of MVP or later?
- Is TTS truly needed for MVP?
- Is battle map mandatory or optional after combat clarity is proven?
- What is the canonical auth strategy?
- What telemetry is allowed by product/privacy goals?

---

## 25. Completion criteria for work done under this document

A task is only “done” when:
- it matches this file or an explicit user override;
- code changes are coherent with the approved architecture;
- state mutations are real, not theatrical;
- validation has been performed and reported honestly;
- any remaining uncertainty is explicitly called out.

---

## 26. Short operating summary for the agent

Build Dungeon Cortex as a rules-backed single-player AI-DM experience.

Protect the core loop first.

Favor truth over flourish.

Prefer small validated steps.

Never confuse design ambition with implemented reality.
