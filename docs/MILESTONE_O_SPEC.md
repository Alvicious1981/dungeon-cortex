# Milestone O — Exploration & Time Engine
## Final Specification

**Status:** FINAL — Architect decisions resolved 2026-04-15
**Authority:** `docs/reference/osr_exploration_rules.md` (primary) + `docs/reference/Dungeon_Cortex_Rule_Pack_Complete_v2.md` (global constraints)
**Rule edition:** D&D 5e 2014 SRD / Basic Rules with OSR/AD&D 1e time scale
**Constraint:** Code is Law — the AI narrator advances time only through `executeExplorationTurn`. It cannot invent resource consumption, encounters, or fatigue.

---

## Architect Decisions (Open Questions Resolved)

| # | Decision |
|---|---|
| **Q1** | Exhaustion Level 1 is applied **immediately** when a mandatory rest is skipped (strict OSR lethality). No warning phase. |
| **Q2** | `partySize` is derived **strictly from the DB**: `COUNT(Combatant WHERE isPlayer=true AND encounterId IN active encounter)`. The AI tool input schema does NOT accept partySize from the model. |
| **Q3** | Light source auto-selection priority: **torches first, then oil flasks** (lanterns). Torches are consumed before the lantern oil supply is touched. |
| **Q4** | New campaigns are seeded with **5 torches and 7 rations per player character**. No initial oil flasks (lanterns must be purchased in-world). |

---

## Mechanical Constants (from `osr_exploration_rules.md`)

| Constant | Value | Derivation |
|---|---|---|
| `TURNS_PER_HOUR` | 6 | 1 Turn = 10 min |
| `TORCH_DURATION_TURNS` | 6 | = 1 hour |
| `OIL_DURATION_TURNS` | 24 | = 4 hours |
| `ENCOUNTER_CHECK_INTERVAL_TURNS` | 2 | Roll every 2 turns |
| `ENCOUNTER_TRIGGER_RESULT` | 1 | 1d6 = 1 triggers |
| `REST_INTERVAL_TURNS` | 6 | 1 rest turn per 6 |
| `RATION_INTERVAL_TURNS` | 144 | 1 ration per 24 hours (6 turns/hour × 24 hours) |
| `INITIAL_TORCHES_PER_PLAYER` | 5 | Q4 decision |
| `INITIAL_RATIONS_PER_PLAYER` | 7 | Q4 decision |

All constants are exported from `lib/rules/exploration.ts`. No magic numbers anywhere else.

---

## 1. Data Layer — Prisma Schema Additions

### 1.1 `Character` model — new field

```prisma
/// D&D 5e 2014 exhaustion level. Range: 0 (none) to 6 (dead).
/// Incremented by executeExplorationTurn when a mandatory rest is skipped (Q1).
/// Decremented by 1 on long rest (per 5e 2014 rules).
exhaustionLevel Int @default(0)
```

### 1.2 `Campaign` model — new relations

```prisma
campaignTime    CampaignTime?
partyInventory  PartyInventory?
```

### 1.3 `CampaignTime` model

```prisma
model CampaignTime {
  id          String @id @default(cuid())
  campaignId  String @unique

  /// Total dungeon turns elapsed since campaign start. 1 turn = 10 minutes.
  /// Monotonically increasing — never decremented.
  totalTurns  Int @default(0)

  /// Derived: floor(totalTurns / TURNS_PER_HOUR). Stored for query efficiency.
  /// Always equals floor(totalTurns / 6). Updated atomically with totalTurns.
  totalHours  Int @default(0)

  /// Turns accumulated in the current rest cycle (0–5).
  /// Reaching REST_INTERVAL_TURNS (6) means rest is mandatory before next turn.
  /// Reset to 0 by applyRest(). Capped at 6 to prevent overflow.
  turnsSinceRest Int @default(0)

  /// Turns accumulated in the current encounter check cycle (0–1).
  /// An encounter roll fires when this reaches ENCOUNTER_CHECK_INTERVAL_TURNS (2).
  /// Resets modulo 2 after each check.
  turnsSinceEncounterCheck Int @default(0)

  /// Turns accumulated in the current ration cycle (0–143).
  /// Ration consumption fires when this reaches RATION_INTERVAL_TURNS (144).
  /// Resets modulo 144 after each consumption.
  turnsSinceRation Int @default(0)

  updatedAt DateTime @updatedAt

  campaign Campaign @relation(fields: [campaignId], references: [id])
}
```

### 1.4 `PartyInventory` model

```prisma
model PartyInventory {
  id          String @id @default(cuid())
  campaignId  String @unique

  /// Unlit torches in the party's pack. Each lasts TORCH_DURATION_TURNS (6) when lit.
  /// Seeded at 5 × partySize on campaign creation (Q4).
  torches     Int @default(0)

  /// Oil flasks in the party's pack. Each lasts OIL_DURATION_TURNS (24) when burning.
  /// Not seeded at campaign creation — must be purchased in-world (Q4).
  oilFlasks   Int @default(0)

  /// Total rations across all party members.
  /// Seeded at 7 × partySize on campaign creation (Q4).
  rations     Int @default(0)

  /// The light source currently being consumed. "none" = darkness.
  /// "torch" | "lantern" | "none"
  activeLightSource String @default("none")

  /// Turns remaining on the active light source.
  /// Decremented every turn. At 0, next source is auto-selected (torches first — Q3).
  lightSourceTurnsRemaining Int @default(0)

  updatedAt DateTime @updatedAt

  campaign Campaign @relation(fields: [campaignId], references: [id])
}
```

---

## 2. Rules Layer — Pure Function Signatures

**File:** `lib/rules/exploration.ts` (appended after existing location generation code)
**Contract:** Pure — no I/O, no Prisma, no side effects. Same inputs → same outputs.

### 2.1 `advanceTurn(state, turns?)`

```typescript
function advanceTurn(state: CampaignTimeState, turns?: number): AdvanceTurnResult
// turns defaults to 1, clamped [1, 6]
// restRequired = (state.turnsSinceRest + turns) >= REST_INTERVAL_TURNS
// turnsSinceRest capped at REST_INTERVAL_TURNS (6) — never overflows
// encounterCheckDue fires when cycle crosses ENCOUNTER_CHECK_INTERVAL_TURNS (2)
// rationConsumptionDue fires when cycle crosses RATION_INTERVAL_TURNS (144)
```

### 2.2 `checkRandomEncounter(loudAction?, forcedRoll?)`

```typescript
function checkRandomEncounter(loudAction?: boolean, forcedRoll?: number): EncounterCheckResult
// Rolls 1d6; triggered if roll === ENCOUNTER_TRIGGER_RESULT (1)
// forcedRoll is a test-only seam — never used in production
```

### 2.3 `consumeResources(inventory, options)`

```typescript
function consumeResources(inventory: PartyInventoryState, options: ConsumeResourcesOptions): ConsumeResourcesResult
// Light: decrement lightSourceTurnsRemaining; if 0, auto-select next source
// Auto-selection priority: torch → lantern → none (Q3)
// Rations: deduct partySize rations if rationConsumptionDue; floor at 0
// Returns warnings[] for narrator voice (last torch, darkness, low rations)
```

### 2.4 `applyRest(state)`

```typescript
function applyRest(state: CampaignTimeState): CampaignTimeState
// Resets turnsSinceRest to 0; all other fields unchanged
```

### 2.5 `initialPartyInventory(partySize)` (campaign seeding helper)

```typescript
function initialPartyInventory(partySize: number): Pick<PartyInventoryState, 'torches' | 'oilFlasks' | 'rations' | 'activeLightSource' | 'lightSourceTurnsRemaining'>
// torches = INITIAL_TORCHES_PER_PLAYER * partySize
// oilFlasks = 0 (Q4)
// rations = INITIAL_RATIONS_PER_PLAYER * partySize
// activeLightSource = "none", lightSourceTurnsRemaining = 0
```

---

## 3. Integration Layer — AI Tool (Slice 3)

### `executeExplorationTurn`

Actions: `"move" | "search" | "rest" | "interact" | "loud"`

**`execute` logic:**
1. Fetch `CampaignTime` + `PartyInventory` + active `Combatant` count (`isPlayer = true`) from DB.
2. If `action === "rest"`: call `applyRest()` → write to DB. Skip resource consumption.
3. Else:
   - `advanceTurn()` → `{ next, restRequired, encounterCheckDue, rationConsumptionDue }`
   - If `restRequired` AND previous `turnsSinceRest` was already at limit → apply Exhaustion Level 1 to Character (Q1).
   - `consumeResources()` → `{ next: nextInventory, warnings }`
   - If `encounterCheckDue` OR `action === "loud"` → `checkRandomEncounter(action === "loud")`
4. `prisma.$transaction([updateCampaignTime, updatePartyInventory])`.
5. Return structured JSON payload.

**Iron Law addition:**
> **Exploration Time Mandate:** Every dungeon turn MUST be advanced by calling `executeExplorationTurn`. NEVER narrate torch burn, ration consumption, exhaustion, or encounters without a tool response. If `restRequired` is true in the response, the NEXT action MUST be `executeExplorationTurn` with `action: "rest"`. Code is Law.

---

## 4. Slice Breakdown

| Slice | Scope | Deliverables |
|---|---|---|
| **O-1** | Data layer + pure rules | Schema, migration, `lib/rules/exploration.ts` additions, ≥60 unit tests |
| **O-2** | AI tool wiring | `lib/ai/narrator.ts` tool, Iron Law in `lib/memory/formatter.ts`, formatter tests |
| **O-3** | Archive | Closure report + commit |

---

## 5. Test Surface — Slice O-1 (minimum 60 tests)

### `advanceTurn`
- Increments `totalTurns` by 1 (default)
- Increments `totalTurns` by N when turns=N
- `totalHours` = `floor(totalTurns / 6)`
- `restRequired = false` at turns 1–5 (from fresh state)
- `restRequired = true` at turn 6 (from fresh state)
- `restRequired = true` immediately if `turnsSinceRest` already at 6
- `turnsSinceRest` never exceeds `REST_INTERVAL_TURNS` (6)
- `encounterCheckDue = true` every 2 turns (from fresh state: turns 2, 4, 6…)
- `encounterCheckDue = false` on turn 1 (from fresh state)
- `rationConsumptionDue = true` at turn 144 (from fresh state)
- `rationConsumptionDue = false` at turn 143 (from fresh state)
- Counter resets correctly after encounter check (modulo 2)
- Counter resets correctly after ration consumption (modulo 144)
- `turnsAdvanced` echoes input (or 1 if default)
- `turns` param clamped at 1 minimum

### `checkRandomEncounter`
- Roll of 1 → `triggered = true`
- Rolls 2–6 → `triggered = false`
- `loudAction = true` → `triggered` still depends on roll (loudAction forces a check, doesn't guarantee trigger)
- `forcedRoll = 1` → triggered
- `forcedRoll = 3` → not triggered
- `loudAction` is echoed in result

### `consumeResources`
- Torch: `lightSourceTurnsRemaining` decrements by 1 each turn
- Torch expiry: at 0, if `torches > 0`, auto-selects next torch (`torches--`, `lightSourceTurnsRemaining = 6`)
- Torch expiry: at 0, no torches, `oilFlasks > 0` → auto-selects lantern (`oilFlasks--`, `lightSourceTurnsRemaining = 24`)
- Torch expiry: at 0, no torches, no oil → `activeLightSource = "none"`, `lightExpired = true`
- Ration deduction: `rationsDue = true`, `partySize = 3` → `rations -= 3`
- Ration floor: `rations` never goes below 0
- `rationsDepleted = true` when rations hit 0 after deduction
- `rationsDepleted = false` when rations remain > 0
- Darkness warning included in `warnings[]` when light goes out
- Low ration warning when rations ≤ partySize (one meal left)
- `rationConsumptionDue = false` → rations unchanged

### `applyRest`
- Resets `turnsSinceRest` to 0
- `totalTurns`, `totalHours`, `turnsSinceEncounterCheck`, `turnsSinceRation` unchanged

### `initialPartyInventory`
- `partySize = 1` → torches=5, rations=7, oilFlasks=0
- `partySize = 4` → torches=20, rations=28, oilFlasks=0
- `activeLightSource = "none"`, `lightSourceTurnsRemaining = 0`
