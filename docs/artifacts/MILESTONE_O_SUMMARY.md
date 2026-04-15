# Milestone O — Exploration & Time Engine: Architecture Closure Report

**Date:** 2026-04-15
**Branch:** master
**Status:** Complete — 0 TypeScript errors, 1069 tests passing (1 pre-existing loot failure excluded)

---

## 1. Scope

Milestone O implements a faithful OSR/AD&D 1e dungeon exploration time system. Every action the party takes in the dungeon consumes time; time triggers torchlight attrition, ration consumption, rest requirements, random encounters, and exhaustion. The AI narrator is forbidden from resolving any of these events — the engine decides, the narrator voices.

---

## 2. Mechanical Constants (`lib/rules/exploration.ts`)

| Constant | Value | Meaning |
|---|---|---|
| `TURNS_PER_HOUR` | 6 | 1 dungeon turn = 10 minutes |
| `TORCH_DURATION_TURNS` | 6 | Torch burns for 1 hour (6 turns) |
| `OIL_DURATION_TURNS` | 24 | Oil flask fuels a lantern for 4 hours |
| `ENCOUNTER_CHECK_INTERVAL_TURNS` | 2 | Random encounter roll every 2 turns |
| `ENCOUNTER_TRIGGER_RESULT` | 1 | 1d6 roll of 1 triggers encounter |
| `REST_INTERVAL_TURNS` | 6 | Party must rest every 6 turns |
| `RATION_INTERVAL_TURNS` | 144 | One ration consumed per 24 hours (144 turns) |
| `INITIAL_TORCHES_PER_PLAYER` | 5 | Starting torches per party member |
| `INITIAL_RATIONS_PER_PLAYER` | 7 | Starting rations per party member |

---

## 3. Data Layer (`prisma/schema.prisma`)

### New field on `Character`
```prisma
exhaustionLevel Int @default(0)
```
Range: 0 (none) – 6 (lethal). Incremented by the `executeExplorationTurn` tool when the party skips a mandatory rest.

### New model: `CampaignTime`
```prisma
model CampaignTime {
  id                       String   @id @default(cuid())
  campaignId               String   @unique
  totalTurns               Int      @default(0)
  totalHours               Int      @default(0)
  turnsSinceRest           Int      @default(0)
  turnsSinceEncounterCheck Int      @default(0)
  turnsSinceRation         Int      @default(0)
  updatedAt                DateTime @updatedAt
  campaign                 Campaign @relation(fields: [campaignId], references: [id])
}
```
One row per campaign. Tracks all time state; reset selectively by `applyRest`.

### New model: `PartyInventory`
```prisma
model PartyInventory {
  id                        String   @id @default(cuid())
  campaignId                String   @unique
  torches                   Int      @default(0)
  oilFlasks                 Int      @default(0)
  rations                   Int      @default(0)
  activeLightSource         String   @default("none")
  lightSourceTurnsRemaining Int      @default(0)
  updatedAt                 DateTime @updatedAt
  campaign                  Campaign @relation(fields: [campaignId], references: [id])
}
```
One row per campaign. `activeLightSource` is `"torch" | "lantern" | "none"` (stored as String, cast in narrator.ts).

Schema applied via `npx prisma db push` (Supabase extension drift prevents `migrate dev`).

---

## 4. Pure Rules Engine (`lib/rules/exploration.ts`)

All functions are side-effect-free. They accept state and return new state — no Prisma, no randomness except `checkRandomEncounter`.

| Function | Inputs | Returns | Notes |
|---|---|---|---|
| `advanceTurn(state, turns?)` | `CampaignTimeState`, optional turns (default 1) | `AdvanceTurnResult` | Advances all counters; sets `restRequired` when `turnsSinceRest >= REST_INTERVAL_TURNS` |
| `checkRandomEncounter(loudAction?, forcedRoll?)` | `boolean`, optional override | `EncounterCheckResult` | Rolls 1d6 every `ENCOUNTER_CHECK_INTERVAL_TURNS`; loud actions double the chance |
| `consumeResources(inventory, options)` | `PartyInventoryState`, `ConsumeResourcesOptions` | `ConsumeResourcesResult` | Handles torch/lantern attrition, chaining torch→lantern→darkness, ration depletion |
| `applyRest(state)` | `CampaignTimeState` | `CampaignTimeState` | Resets `turnsSinceRest` and `turnsSinceEncounterCheck` to 0 |
| `initialPartyInventory(partySize)` | `number` | `PartyInventoryState` | Returns starter kit: `partySize × INITIAL_TORCHES_PER_PLAYER` torches + rations, activeLightSource `"none"` |

**Architect decisions (locked):**
- Q1: Exhaustion applied immediately when rest is skipped (not deferred)
- Q2: `partySize` is never accepted from AI input; derived from active encounter combatants in DB
- Q3: Torches consumed before lantern oil
- Q4: 5 torches + 7 rations per player at campaign creation

---

## 5. AI Tool (`lib/ai/narrator.ts` → `buildTools()`)

### `executeExplorationTurn`

**Input schema:**
```typescript
z.object({
  action: z.enum(["move", "search", "rest", "interact", "loud"]),
  turnsToAdvance: z.number().int().min(1).max(6).default(1),
}).strict()
```
`partySize` is intentionally absent — always derived from DB (Q2).

**Execute flow:**
1. Fetch `campaignRec`, `campaignTime`, `partyInventory`, active encounter (for partySize)
2. **Rest branch** (`action === "rest"`): call `applyRest()` → upsert `CampaignTime`; restore exhaustion if applicable
3. **Non-rest branch:**
   - Check `restAlreadyOverdue` (Q1 exhaustion gate)
   - Call `advanceTurn(currentTime, turnsToAdvance)`
   - If `restAlreadyOverdue && turnResult.restRequired`: increment `character.exhaustionLevel`
   - Call `consumeResources(currentInventory, { turnsElapsed, partySize, consumeRations })`
   - Call `checkRandomEncounter(action === "loud")` if encounter check interval reached
   - `prisma.$transaction([upsertTime, upsertInventory])` — atomic write
4. Return full JSON payload:
```typescript
{
  action, turnsAdvanced, totalTurns, totalHours,
  restRequired,           // true → next action MUST be rest
  exhaustionApplied,      // true if exhaustionLevel was incremented
  encounter,              // { triggered: boolean, roll: number } | null
  lightSource,            // "torch" | "lantern" | "none"
  lightSourceTurnsLeft,
  lightExpired,           // true if light source ran out this turn
  rationsDepleted,        // true if rations reached 0
  warnings,               // string[] — diegetic events for narrator to voice
}
```

**Iron Laws injection (`lib/memory/formatter.ts` → `formatIronLaws()`):**
> "Exploration Time Mandate: Every dungeon action the party takes MUST be advanced by calling `executeExplorationTurn`... Code is Law."

---

## 6. Context Injection (`lib/memory/formatter.ts`)

### `ExplorationHUDContext` interface
```typescript
export interface ExplorationHUDContext {
  totalTurns: number; totalHours: number; turnsSinceRest: number;
  activeLightSource: "torch" | "lantern" | "none";
  lightSourceTurnsRemaining: number; torches: number;
  oilFlasks: number; rations: number; exhaustionLevel: number;
}
```

### `formatSurvivalHUD(ctx: ExplorationHUDContext): string`
Returns a `## ⏳ Dungeon Clock` prompt section injected into the system prompt when `explorationHUD` is present in context. Displays: elapsed time (hours + minutes), rest countdown or overdue warning, exhaustion level, active light source with turns remaining, reserves, and rations.

### `formatSystemPrompt()` signature update
```typescript
context: CampaignContext & { gold?: number; activeNPC?: ActiveNPC; explorationHUD?: ExplorationHUDContext }
```

---

## 7. UI Component (`components/exploration/SurvivalHUD.tsx`)

Read-only presentational panel. Receives all values via props from the caller (DB-fetched). No state mutations, no AI calls, no invented values.

### State → UI Mapping

| Prop | `data-testid` | Behavior |
|---|---|---|
| `totalTurns` | `total-turns` | Raw turn counter |
| `totalHours` + `totalTurns % 6 * 10` | `elapsed-time` | e.g., "2h 0min" |
| `turnsSinceRest` | `rest-status` | "Rest in N turn(s)" or "⚠️ Rest Overdue"; `data-overdue="true\|false"` |
| `exhaustionLevel` | `exhaustion` (conditional) | Hidden when 0; `data-level={N}` |
| `activeLightSource` | `light-icon` + `light-label` | 🕯️ Torch / 🏮 Lantern / ⬛ Darkness |
| `lightSourceTurnsRemaining` | `light-turns-remaining` | Absent when `activeLightSource === "none"` |
| `torches` | `torches` | Reserve count |
| `oilFlasks` | `oil-flasks` | Reserve count |
| `rations` | `rations` | Raw count |

Root element: `aria-label="Dungeon Clock and Survival Status"`, `data-total-turns={totalTurns}`.

---

## 8. Test Coverage

| Suite | File | Count |
|---|---|---|
| Rules engine | `tests/rules/exploration.test.ts` | 167 (92 new in Milestone O) |
| Formatter | `tests/memory/formatter.test.ts` | +25 (Exploration Mandate + HUD) |
| SurvivalHUD component | `tests/components/SurvivalHUD.test.tsx` | 40 |
| **Total (full suite)** | — | **1069 passing** |

Pre-existing failure: `tests/rules/loot.test.ts > rollMagicItems > all items pass LootItemSchema validation` — out of scope.

---

## 9. Files Modified / Created

| File | Change |
|---|---|
| `prisma/schema.prisma` | Added `exhaustionLevel` on Character; `CampaignTime` and `PartyInventory` models |
| `lib/rules/exploration.ts` | Appended time engine constants, types, and 5 pure functions |
| `lib/ai/narrator.ts` | Added `executeExplorationTurn` tool to `buildTools()` |
| `lib/memory/formatter.ts` | Added Exploration Time Mandate; `ExplorationHUDContext`; `formatSurvivalHUD()`; updated `formatSystemPrompt()` |
| `components/exploration/SurvivalHUD.tsx` | New read-only component |
| `tests/rules/exploration.test.ts` | +92 time engine tests |
| `tests/memory/formatter.test.ts` | +25 exploration formatter tests |
| `tests/components/SurvivalHUD.test.tsx` | New — 40 component tests |
| `docs/MILESTONE_O_SPEC.md` | Finalized spec (Q1–Q4 locked) |
| `docs/reference/README.md` | Reference directory manifest |

---

## 10. Code is Law — Compliance Summary

- **AI tool never invents resource consumption.** All deductions flow through `consumeResources()` → DB transaction.
- **AI tool never invents encounters.** `checkRandomEncounter()` rolls the d6; result is returned in payload.
- **AI tool never invents exhaustion.** `exhaustionApplied` flag is set only by the tool; DB write is authoritative.
- **`partySize` is never AI-supplied.** Derived exclusively from active encounter combatant rows.
- **`SurvivalHUD` is purely presentational.** Zero side effects; renders exactly what the DB contains.
