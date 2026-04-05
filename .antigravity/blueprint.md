# Dungeon Cortex — Technical Architecture Blueprint

**Generated:** 2026-04-02
**Template:** standard_app
**Source of truth:** PROJECT_CONTEXT.md + live codebase audit

---

## 1. SYSTEM OVERVIEW

### Application Identity

**Dungeon Cortex** is a single-player AI Dungeon Master web application built on Next.js 15. The system delivers a rules-backed tabletop D&D 5e experience: the AI narrates; deterministic code validates every mechanic.

### Runtime Stack

| Layer | Technology | Notes |
|---|---|---|
| Framework | Next.js 15 (App Router) | Server Components + Route Handlers |
| Language | TypeScript 5 | Strict mode |
| Styling | Tailwind CSS 4 | Utility-first, dark theme baseline |
| ORM | Prisma 6 | `@prisma/client` generated under `app/generated/prisma` |
| Database | PostgreSQL | Primary persistence store |
| Vector search | pgvector (planned) | Memory/recall retrieval — not yet implemented |
| AI SDK | Vercel AI SDK (planned) | Streaming narrative generation |
| Rules content | D&D 5e API (`dnd5eapi.co`) | Cached 24h via Next.js `revalidate` |
| Package manager | pnpm | Lock file present |

### Architectural Layers

```
┌─────────────────────────────────────────────────────┐
│  Presentation Layer  (app/  — React Server + Client) │
│  Pages: /, /character/create, /campaign/[id] (todo)  │
├─────────────────────────────────────────────────────┤
│  API Layer  (app/api/  — Next.js Route Handlers)     │
│  POST /api/character   ← implemented                 │
│  POST /api/campaign    ← not yet implemented         │
│  POST /api/action      ← not yet implemented         │
├─────────────────────────────────────────────────────┤
│  Core Logic Layer  (lib/)                            │
│  lib/db/        — Prisma client, dev-user helper     │
│  lib/dnd-api/   — D&D 5e API client with fallbacks   │
│  lib/ai/        ← not yet implemented                │
│  lib/rules/     ← not yet implemented                │
│  lib/memory/    ← not yet implemented                │
├─────────────────────────────────────────────────────┤
│  Data Layer  (PostgreSQL via Prisma)                 │
│  Models: User, Character, Campaign, GameLog          │
│  Planned: InventoryItem, CombatEncounter, Quest, NPC │
└─────────────────────────────────────────────────────┘
```

### Current Implementation State (as of 2026-04-02)

| Area | Status |
|---|---|
| Landing page (`/`) | Implemented |
| Character creation UI (`/character/create`) | Implemented |
| `POST /api/character` | Implemented — validates stats, persists to DB |
| D&D 5e API client (races, classes) | Implemented — fallback-safe |
| Database schema (User/Character/Campaign/GameLog) | Implemented — partial (missing combat/inventory/quest/NPC) |
| Campaign creation flow | Not implemented |
| Narrative chat loop | Not implemented |
| Rules engine | Not implemented |
| Combat system | Not implemented |
| Memory/recall layer | Not implemented |
| Auth (production) | Not implemented — dev-user stub in use |

### Design Principles

1. **Code is Law** — rules validation is deterministic and server-owned
2. **Single-player first** — no multiplayer scope in current milestones
3. **Diegetic immersion** — UI reinforces fiction without sacrificing clarity
4. **Fast time-to-fun** — minimal friction from launch to first session
5. **Incremental trust** — never fake state, completion, or persistence

---

## 2. DATABASE SCHEMA

### Current Schema (Prisma — `prisma/schema.prisma`)

```prisma
model User {
  id         String      @id @default(cuid())
  email      String      @unique
  name       String?
  createdAt  DateTime    @default(now())
  characters Character[]
  campaigns  Campaign[]
}

model Character {
  id        String     @id @default(cuid())
  userId    String
  name      String
  race      String
  class     String
  level     Int        @default(1)
  hp        Int
  maxHp     Int
  stats     Json       // { STR, DEX, CON, INT, WIS, CHA }
  createdAt DateTime   @default(now())
  user      User       @relation(fields: [userId], references: [id])
  campaigns Campaign[]
}

model Campaign {
  id          String    @id @default(cuid())
  userId      String
  characterId String
  title       String
  status      String    @default("active")
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  user        User      @relation(fields: [userId], references: [id])
  character   Character @relation(fields: [characterId], references: [id])
  logs        GameLog[]
}

model GameLog {
  id         String   @id @default(cuid())
  campaignId String
  role       String   // "user" | "assistant" | "system"
  content    String
  createdAt  DateTime @default(now())
  campaign   Campaign @relation(fields: [campaignId], references: [id])
}
```

### Planned Schema Extensions (Milestone B–D)

```prisma
// Milestone B — Combat clarity
//
// Design decisions:
//   - Encounter.status is a string enum ("active" | "resolved" | "fled") rather
//     than a Postgres enum so migrations stay simple until the schema stabilises.
//   - currentTurnIndex is a zero-based pointer into the ordered Combatant list
//     (ordered by initiativeTotal DESC). Advancing a turn = increment mod count.
//     Storing it here avoids re-sorting on every request and makes the state
//     resumable from a single row read.
//   - round tracks the full combat loop count for display and rules checks
//     (e.g. concentration duration, condition expiry).
//   - Combatant.initiativeTotal is the final computed value (naturalRoll +
//     dexModifier) that determines turn order. The raw roll components live in
//     the GameLog as a system entry — not duplicated here.
//   - Combatant.isPlayer distinguishes PC from NPC/monster rows so the UI can
//     style and the rules engine can gate player-only actions.
//   - Combatant.conditions is a Json string[] so new conditions can be added
//     without schema migrations during Milestone B iteration.

model Encounter {
  id                String      @id @default(cuid())
  campaignId        String
  status            String      @default("active")
  // "active"   — combat is ongoing
  // "resolved" — encounter ended normally (victory/surrender)
  // "fled"     — party disengaged
  round             Int         @default(1)
  currentTurnIndex  Int         @default(0)
  // Zero-based index into Combatant rows ordered by initiativeTotal DESC.
  // Increment (mod total combatants) to advance the turn.
  createdAt         DateTime    @default(now())
  updatedAt         DateTime    @updatedAt

  campaign          Campaign    @relation(fields: [campaignId], references: [id])
  combatants        Combatant[]
}

model Combatant {
  id              String    @id @default(cuid())
  encounterId     String
  name            String
  isPlayer        Boolean   @default(false)
  hp              Int
  maxHp           Int
  initiativeTotal Int
  // naturalRoll + dexModifier. Determines turn order (DESC).
  conditions      Json      @default("[]")
  // String[] of active condition names, e.g. ["Prone", "Poisoned"].

  encounter       Encounter @relation(fields: [encounterId], references: [id])
}

// Milestone C — Inventory & spells
model InventoryItem {
  id          String    @id @default(cuid())
  characterId String
  name        String
  type        String    // "weapon" | "armor" | "consumable" | "spell" | "misc"
  quantity    Int       @default(1)
  properties  Json
  character   Character @relation(...)
}

// Milestone D — Memory & continuity
model Quest {
  id         String   @id @default(cuid())
  campaignId String
  title      String
  status     String   // "active" | "completed" | "failed"
  notes      String?
  updatedAt  DateTime @updatedAt
  campaign   Campaign @relation(...)
}

model NPC {
  id         String   @id @default(cuid())
  campaignId String
  name       String
  relation   String?
  notes      String?
  embedding  Unsupported("vector(1536)")?  // pgvector
  campaign   Campaign @relation(...)
}

model MemoryRecord {
  id         String   @id @default(cuid())
  campaignId String
  summary    String
  type       String   // "event" | "npc" | "location" | "quest"
  embedding  Unsupported("vector(1536)")?
  createdAt  DateTime @default(now())
  campaign   Campaign @relation(...)
}
```

### Schema Invariants

- A Campaign belongs to exactly one User and one Character
- Encounter state must be fully resumable from `round` + `currentTurnIndex` + ordered Combatant rows alone — no in-memory state required
- `currentTurnIndex` is always a valid zero-based index into the Combatant list sorted by `initiativeTotal DESC`; increment mod combatant count to advance turns
- `Combatant.initiativeTotal` is the final computed value (naturalRoll + dexModifier); raw roll breakdown is written to GameLog as a `role: "system"` entry — never duplicated in the Combatant row
- `Combatant.conditions` is append/remove only — never overwrite the full array blindly; use read-modify-write with optimistic concurrency to avoid lost updates
- InventoryItem quantities and properties affect real mechanics
- MemoryRecord embeddings enable semantic recall without overriding canonical state tables
- GameLog is append-only; never mutate existing entries

---

## 3. API ENDPOINTS / CORE LOGIC

### Implemented Endpoints

#### `POST /api/character`
**File:** `app/api/character/route.ts`
**Purpose:** Create a new player character with validated D&D 5e stats
**Auth:** Dev-user stub (`lib/db/dev-user.ts`) — production auth not yet implemented

Request body:
```json
{
  "name": "string",
  "race": "string",
  "class": "string",
  "stats": { "STR": 15, "DEX": 14, "CON": 13, "INT": 12, "WIS": 10, "CHA": 8 }
}
```

Logic:
1. Validate all six ability scores are present and numeric
2. Compute `maxHp = hitDie(class) + CON_modifier`
3. Persist Character record via Prisma
4. Return `{ id }` with 201

Response: `{ "id": "clxxxx" }` (201) or `{ "error": "..." }` (400)

---

### Planned Endpoints (Milestone A–C)

#### `POST /api/campaign`
Create a new campaign for a character. Validates character ownership. Returns campaign id.

#### `GET /api/campaign/[id]`
Load full campaign state: character, active encounter, recent logs, active quests.

#### `POST /api/campaign/[id]/action`
**Core gameplay endpoint.**
Pipeline:
1. Parse player action intent
2. Validate rules legality (spell slots, action economy, range, conditions)
3. Resolve mechanics deterministically (dice rolls, hit/miss, damage)
4. Persist all state mutations (hp, spell slots, conditions, inventory)
5. Build AI context from campaign state + semantic memory recall
6. Stream narrative response via Vercel AI SDK
7. Append GameLog entries for both player action and AI response

#### `POST /api/campaign/[id]/combat/start`
Initialize a CombatEncounter: roll initiative, set turn order, set status to "active".

#### `POST /api/campaign/[id]/combat/action`
Process a combat turn action (attack, spell, item, disengage). Separate from narrative action endpoint.

#### `GET /api/dnd/races` and `GET /api/dnd/classes`
Proxy/cache wrapper around `lib/dnd-api/client.ts` for frontend consumption.

---

### Core Logic Modules (Planned)

#### `lib/rules/`
- `combat.ts` — initiative, attack resolution, damage, conditions
- `spells.ts` — spell slot validation, effect application
- `checks.ts` — ability/skill check resolution (d20 + modifier vs DC)
- `inventory.ts` — item usage, weight, attunement

#### `lib/ai/`
- `narrator.ts` — prompt construction, context assembly, streaming via Vercel AI SDK
- `intent-parser.ts` — extract structured action intent from free-text player input

#### `lib/memory/`
- `recall.ts` — pgvector semantic search over MemoryRecord
- `summarizer.ts` — session-end summarization, memory compaction

#### Resolution Contract (per consequential action)

```
detect intent → validate legality → resolve mechanics
→ persist state → recall context → stream narration
```

The AI narrates; code owns the truth.

---

## 4. AGENT DELEGATION MATRIX

This matrix defines which agent types are best suited for each subsystem task in Dungeon Cortex, aligned with the model-routing hints in PROJECT_CONTEXT.md §15.

### Agent Types in Use

| Agent ID | Role | Preferred Model |
|---|---|---|
| `architect` | Architecture decisions, schema design, cross-subsystem planning | Claude Opus 4.6 (thinking) |
| `implementer` | Focused codebase edits, feature slices, route handlers | Claude Sonnet 4.6 |
| `rules-engine` | D&D mechanics validation, combat logic, deterministic resolution | Claude Sonnet 4.6 |
| `ui-ux` | React components, Tailwind styling, accessibility, mobile | Claude Sonnet 4.6 |
| `debugger` | Bug investigation, test failures, unexpected behavior | Claude Sonnet 4.6 |
| `memory-agent` | pgvector integration, recall pipelines, summarization | Claude Opus 4.6 |
| `truth-reporter` | Repo audit, baseline truth reports, gap analysis | Claude Sonnet 4.6 |

### Delegation by Task

| Task | Delegate To | Skill |
|---|---|---|
| Schema migration planning | `architect` | `rules-engine-integrity` |
| `POST /api/campaign/[id]/action` implementation | `implementer` | `feature-slice-delivery` |
| Combat resolution logic (`lib/rules/combat.ts`) | `rules-engine` | `rules-engine-integrity` |
| Character creation UI polish | `ui-ux` | `combat-ui-ux` |
| Combat UI panel build | `ui-ux` | `combat-ui-ux` |
| pgvector memory layer | `memory-agent` | `feature-slice-delivery` |
| Vercel AI SDK streaming integration | `implementer` | `feature-slice-delivery` |
| Bug triage on unexpected behavior | `debugger` | `bug-investigation` |
| Repo state audit before major feature | `truth-reporter` | `repo-truth-report` |
| Initiative tracker + turn clarity | `ui-ux` + `rules-engine` | `combat-ui-ux` |

### Escalation Rules

1. **Never guess at current state.** Run `repo-truth-report` before any multi-file implementation.
2. **Rules logic changes** must go through `rules-engine` agent — never embed D&D mechanics directly in React components or API route bodies.
3. **AI prompt changes** must be isolated to `lib/ai/narrator.ts` — never inline system prompts in route handlers.
4. **Schema changes** require `architect` sign-off before migration is run.
5. **State mutations** (hp, spell slots, conditions, inventory) must happen in `lib/rules/` — never in the narration path.

### Current Active Delegation

| Milestone | Status | Owner |
|---|---|---|
| A — Playable foundation | Completed | `implementer` |
| B — Combat clarity | Completed | `@rules-engine` |
| C — Magic and state depth | Completed | `rules-engine` + `implementer` |
| D — Memory and continuity | Completed | `memory-agent` |
| E — Immersion and accessibility | In progress | `ui-ux` |
| F — Production hardening | Not started | `implementer` |

---

*This blueprint reflects the live codebase state as of generation date. Re-run `repo-truth-report` before acting on milestone B or later to confirm current implementation reality.*
