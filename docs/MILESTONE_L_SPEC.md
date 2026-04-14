# Milestone L — "The Forge" — Character Progression & Hybrid XP System

> **Precedence:** This document is subordinate to `PROJECT_CONTEXT.md` §25 (Precedence Order) and explicit user instructions.
> **Status:** Approved for execution — slice by slice.
> **Prerequisite:** Milestone K (Economy & World Weaver) — confirmed 100% closed and committed to git.

---

## 1. Objective

Implement a **Character Progression & Hybrid XP System** ("The Forge") that awards experience points from **two distinct mechanical triggers** — Combat and Exploration — and resolves level-ups through a structured, rules-backed pipeline. The system:

1. **Combat Trigger:** When an encounter ends in Victory (`reason: "all_enemies_dead"`), the engine automatically computes XP from the defeated enemies' Challenge Ratings (using the existing `xpForCR()` table in `lib/rules/encounters.ts`) and awards it via the `awardXP` tool.
2. **Exploration Trigger:** When players discover **hidden/secret** LocationNodes, reveal **locked** passages, overcome **hazard** nodes, or reach **exit** nodes for the first time (using the World Weaver system from Milestone K-B), the engine awards Exploration XP via the `awardXP` tool.
3. **Ascension:** When `computeXPAward()` returns `leveledUp: true`, the system flags the character for a **"Level Up"** event. The AI narrates the ascension moment, and the `triggerLevelUp` tool resolves class-specific HP gains (hit dice + CON modifier), persists the new `level` and `maxHp`, and returns the results.
4. **Hit Dice & Class Identity:** Each character class has a defined hit die (d6 through d12). On level-up, the system rolls (or uses average) the class-specific hit die + CON modifier to increase `maxHp`. The Character model tracks `hitDice` spent during short rests.
5. **UI Celebration:** A cinematic **"Ascension Overlay"** React component renders over the VTT when a level-up occurs, displaying the new level, HP gains, and a confirmation button before the game continues.

### Design Pillars (inherited from PROJECT_CONTEXT.md)

| Pillar | Application in Milestone L |
|---|---|
| **Code is Law** | Prisma tracks XP and levels. The AI narrator may NEVER invent stat increases, HP changes, or level-up effects. The `triggerLevelUp` tool is the single source of truth for all character advancement. The `awardXP` tool is the single source of truth for XP grants. |
| **Readability beats spectacle** | The Ascension Overlay must clearly communicate what changed — new level, HP increase, and any new capabilities. Clarity > flash. |
| **Diegetic immersion** | Level-up is narrated as an in-world moment — muscles hardening, reflexes quickening, divine favor enveloping the character. Never "you leveled up." |
| **100% Test Coverage Requirement** | Every pure function must have comprehensive unit tests. Every Zod schema must have validation tests. No slice is complete until `pnpm test` passes with full coverage of the new code. |

---

## 2. Core Loop — Hybrid XP Flow

```
  ┌────────────────────────────────────────────────────────────────────────┐
  │                      TWO XP SOURCES                                   │
  │                                                                        │
  │  COMBAT                              EXPLORATION                       │
  │  ──────                              ───────────                       │
  │  resolveEncounterEnd()               moveToNode() / generateLocation() │
  │  → reason: "all_enemies_dead"        → node.feature == "hazard"        │
  │                                      → node.feature == "exit"          │
  │  Compute: sum of xpForCR(enemy.cr)   → edge.passageType == "hidden"    │
  │  for each defeated enemy             → edge.passageType == "locked"    │
  │                                      → node.feature == "treasure"      │
  │  AI calls awardXP({                  → first discovery of any node     │
  │    characterId, amount, reason       │                                 │
  │  })                                  AI calls awardXP({                │
  │                                        characterId, amount, reason     │
  │                                      })                                │
  └───────────────┬──────────────────────┬─────────────────────────────────┘
                  │                      │
                  ▼                      ▼
          ┌───────────────────────────────────┐
          │  computeXPAward(currentXP,        │
          │    currentLevel, amount)           │
          │                                   │
          │  Returns: { newXP, newLevel,       │
          │             leveledUp }            │
          │                                   │
          │  Prisma: Character.xp = newXP     │
          │  Prisma: Character.level = newLevel│
          └──────────────┬────────────────────┘
                         │
                         ▼
             ┌──── leveledUp? ────┐
             │                    │
         NO  │              YES   │
             ▼                    ▼
       Continue play    AI MUST call triggerLevelUp({
                          characterId
                        })
                              │
                              ▼
                  ┌───────────────────────────┐
                  │  triggerLevelUp (pure)     │
                  │                           │
                  │  1. Lookup class hit die   │
                  │  2. Roll hit die + CON mod │
                  │  3. Compute new maxHp      │
                  │  4. Restore hp to maxHp    │
                  │  5. Persist to Prisma      │
                  └──────────┬────────────────┘
                             │
                             ▼
                  Tool returns LevelUpPayload
                             │
                             ▼
                  AI narrates the ascension
                             │
                             ▼
                  UI: AscensionOverlay renders
                  Player confirms → game continues
```

---

## 3. Existing Infrastructure Audit

### What exists (Milestone K baseline)

| Module | State | Relevance to Milestone L |
|--------|-------|--------------------------|
| `lib/rules/progression.ts` | `getLevelFromXP()`, `canLevelUp()`, `xpForLevel()`, `computeXPAward()` — full SRD XP threshold table | **Foundation** — all XP math already exists; Milestone L extends with HP-roll and class mechanics |
| `lib/rules/encounters.ts` | `xpForCR()`, `encounterMultiplier()`, `CR_XP_TABLE` — DMG p.275 XP values | **Reuse** — combat XP computed from this table |
| `lib/rules/proficiency.ts` | `CharacterClass` type, `proficiencyBonus()` | **Reuse** — class type for hit die lookup; proficiency bonus for level-up context |
| `lib/rules/dice.ts` | `roll()`, `rollN()`, `abilityModifier()` | **Reuse** — HP roll uses `roll("1dX+Y")` pattern |
| `lib/ai/narrator.ts` | `awardXP` tool — full AI-callable XP grant with auto level-up detection | **Extend** — already handles XP award + level detection; needs to trigger `triggerLevelUp` on level-up |
| `prisma/schema.prisma` | `Character` model with `xp`, `level`, `hp`, `maxHp`, `class`, `stats` | **Update** — add `hitDiceRemaining`, `hitDiceTotal` columns |
| `lib/memory/formatter.ts` | `formatCharacter()` — shows XP progress bar, level, HP | **Update** — add hit dice display + exploration XP mandate |
| `lib/memory/context.ts` | `ContextCharacter` — includes `xp`, `level`, `class` | **Already complete** — no changes needed |
| `components/character/` | `CharacterCreationForm.tsx`, `InventoryPanel.tsx` | **Reference** — component architecture patterns |
| `lib/rules/exploration.ts` | World Weaver node graph + feature system | **Integration** — node features trigger exploration XP |

### What is missing

1. **Hit Die per class** — no `HIT_DIE_MAP` data constant mapping `CharacterClass → die size`.
2. **`rollHitPointGain()`** — no function to compute HP gained on level-up.
3. **`computeCombatXP()`** — no function to calculate total XP from a list of defeated enemy CRs.
4. **`computeExplorationXP()`** — no function to calculate XP from node discovery events.
5. **`triggerLevelUp` AI tool** — the narrator has no way to resolve the mechanical effects of a level-up.
6. **`hitDiceRemaining` / `hitDiceTotal` columns** — Character model doesn't track hit dice for short rests.
7. **Level-Up Generation Mandate** in Iron Laws — the AI is not yet constrained to use `triggerLevelUp` after a level-up.
8. **"Ascension Overlay" UI** — no cinematic level-up celebration component exists.
9. **`LevelUpPayload` Zod schema** — no structured schema for the `triggerLevelUp` tool response.

---

## 4. Slice 1 — Data Layer

**Priority:** P0 — Must be first. All other slices depend on this.
**Philosophy:** Schema first, types second, validation third. No business logic in this slice.

### 4.1. Prisma Schema Updates

#### Character model additions:

```prisma
model Character {
  // ... existing fields (id, userId, name, race, class, level, hp, maxHp, stats,
  //                      spellSlots, xp, concentrationSpellId, createdAt) ...

  /// Total hit dice the character possesses (= level). Equals the number of
  /// hit dice available at full rest. Decremented by short rest healing.
  hitDiceTotal      Int     @default(1)
  /// Remaining hit dice available for short rest healing.
  /// Reset to hitDiceTotal on long rest. Must satisfy 0 ≤ remaining ≤ total.
  hitDiceRemaining  Int     @default(1)

  // ... existing relations ...
}
```

**Migration name:** `add_character_hit_dice`

**Why `hitDiceTotal` and not derived from `level`?** — While hit dice count equals level in baseline 5e, storing it explicitly enables future features (multi-class, feats that grant bonus hit dice) without schema changes. Milestone L keeps them in sync with `level` via the `triggerLevelUp` tool.

### 4.2. Character Class Hit Die Map

Define in `lib/rules/progression.ts` alongside the existing XP threshold table:

```typescript
/**
 * Hit die size per character class — 5e 2014 SRD.
 * Maps the CharacterClass (from proficiency.ts) to the die face count
 * used for HP rolls on level-up and short-rest healing.
 */
export const HIT_DIE_MAP: Readonly<Record<CharacterClass, number>> = {
  barbarian: 12,
  bard:       8,
  cleric:     8,
  druid:      8,
  fighter:   10,
  monk:       8,
  paladin:   10,
  ranger:    10,
  rogue:      8,
  sorcerer:   6,
  warlock:    8,
  wizard:     6,
} as const;
```

This data is a **pure constant** — no computation, no I/O.

### 4.3. Exploration XP Constants

Define in `lib/rules/progression.ts`:

```typescript
/**
 * XP awarded per exploration event type.
 * These values are tuned for a solo-character campaign where
 * combat XP averages 200–1800 per encounter (CR 1–5).
 *
 * The AI narrator calls awardXP() with these amounts whenever
 * the corresponding World Weaver event fires.
 */
export const EXPLORATION_XP = {
  /** Discovering any new node for the first time. */
  node_discovery:      25,
  /** Revealing a hidden passage (passageType === "hidden"). */
  hidden_passage:      75,
  /** Opening a locked passage (passageType === "locked"). */
  locked_passage:      50,
  /** Surviving a hazard node (feature === "hazard"). */
  hazard_survived:    100,
  /** Reaching an exit node (feature === "exit") — completing the location. */
  exit_reached:       150,
  /** Discovering a treasure node (feature === "treasure"). */
  treasure_found:      50,
  /** Finding a quest hook node (feature === "quest_hook"). */
  quest_hook_found:    50,
} as const;

export type ExplorationXPEvent = keyof typeof EXPLORATION_XP;
```

### 4.4. Zod Schemas for Tool I/O

#### TriggerLevelUp input schema:

```typescript
export const TriggerLevelUpInputSchema = z.object({
  characterId: z
    .string()
    .min(1)
    .describe(
      "The character's ID from the Character State section. " +
      "MUST match the character who just leveled up."
    ),
  useAverage: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      "If true, use the average HP roll (ceil(hitDie/2) + 1) instead of rolling. " +
      "Default: false (roll the hit die)."
    ),
});

export type TriggerLevelUpInput = z.infer<typeof TriggerLevelUpInputSchema>;
```

#### LevelUp result payload:

```typescript
export const LevelUpPayloadSchema = z.object({
  characterId: z.string(),
  previousLevel: z.number().int().min(1).max(19),
  newLevel: z.number().int().min(2).max(20),
  hitDie: z.string().describe("e.g. '1d10'"),
  hpRoll: z.number().int().min(1),
  conModifier: z.number().int(),
  hpGained: z.number().int().min(1),
  previousMaxHp: z.number().int().min(1),
  newMaxHp: z.number().int().min(2),
  newHitDiceTotal: z.number().int().min(2),
  className: z.string(),
});

export type LevelUpPayload = z.infer<typeof LevelUpPayloadSchema>;
```

#### CombatXP input schema (for the `computeCombatXP` pure function):

```typescript
export const CombatXPInputSchema = z.object({
  enemyCRs: z
    .array(z.number().min(0).max(30))
    .min(1)
    .describe("Array of Challenge Ratings for every defeated enemy in the encounter."),
});

export type CombatXPInput = z.infer<typeof CombatXPInputSchema>;
```

#### ExplorationXP input schema:

```typescript
export const ExplorationXPInputSchema = z.object({
  event: z
    .enum([
      "node_discovery",
      "hidden_passage",
      "locked_passage",
      "hazard_survived",
      "exit_reached",
      "treasure_found",
      "quest_hook_found",
    ])
    .describe("The type of exploration achievement triggered."),
  nodeIndex: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe("Index of the node/edge involved, for dedup tracking."),
});

export type ExplorationXPInput = z.infer<typeof ExplorationXPInputSchema>;
```

### 4.5. Slice 1 Task Breakdown

| Task | File | Type | Depends On |
|------|------|------|------------|
| 1.1 Schema migration: add `hitDiceTotal`, `hitDiceRemaining` to Character | `prisma/schema.prisma` | Migration | — |
| 1.2 Run `pnpm prisma generate` to regenerate client | — | Command | 1.1 |
| 1.3 Define `HIT_DIE_MAP` constant — `CharacterClass → die size` | `lib/rules/progression.ts` | Data | — |
| 1.4 Define `EXPLORATION_XP` constant + `ExplorationXPEvent` type | `lib/rules/progression.ts` | Data | — |
| 1.5 Define `TriggerLevelUpInputSchema` (Zod) | `lib/rules/progression.ts` | Schema | — |
| 1.6 Define `LevelUpPayloadSchema` (Zod) | `lib/rules/progression.ts` | Schema | — |
| 1.7 Define `CombatXPInputSchema` (Zod) | `lib/rules/progression.ts` | Schema | — |
| 1.8 Define `ExplorationXPInputSchema` (Zod) | `lib/rules/progression.ts` | Schema | 1.4 |
| 1.9 Import `CharacterClass` type from `proficiency.ts` in `progression.ts` | `lib/rules/progression.ts` | Types | — |
| 1.10 Write unit tests for all Zod schemas (valid + invalid inputs, edge cases) | `tests/rules/progression.test.ts` | Tests | 1.5–1.8 |
| 1.11 Type-check: `pnpm tsc --noEmit` | — | Validation | 1.1–1.9 |

### 4.6. Acceptance Criteria

- [ ] `Character` has `hitDiceTotal` and `hitDiceRemaining` columns (both default 1).
- [ ] `HIT_DIE_MAP` covers all 12 SRD classes.
- [ ] `EXPLORATION_XP` defines XP values for all 7 event types.
- [ ] All Zod schemas parse valid inputs and reject malformed ones.
- [ ] Schema tests cover: empty `enemyCRs` array (rejected — min 1), negative CRs, level boundaries (1–20), invalid `event` strings.
- [ ] `pnpm test` passes.
- [ ] `pnpm tsc --noEmit` passes.

---

## 5. Slice 2 — The Forge Engine

**Priority:** P0 — Must complete before UI integration.
**Philosophy:** Pure math first, tool integration second. Every function deterministic given inputs.

### 5.1. `rollHitPointGain()` — Pure HP Roll

```
function rollHitPointGain(
  className: CharacterClass,
  conModifier: number,
  useAverage?: boolean
): { hpRoll: number; hpGained: number }

  1. hitDie = HIT_DIE_MAP[className]
  2. If useAverage:
       hpRoll = Math.ceil(hitDie / 2) + 1   // 5e PHB "average" column
     Else:
       hpRoll = roll("1d" + hitDie).total    // random
  3. hpGained = Math.max(1, hpRoll + conModifier)
     // Floor of 1 HP per level — a character ALWAYS gains at least 1 HP.
  4. Return { hpRoll, hpGained }
```

This is the **core mechanical calculation** of level-up. It is a pure function (with optional randomness from `roll()`).

**Important guarantee:** `hpGained >= 1` always, even with negative CON modifiers. A character never loses max HP by leveling up.

### 5.2. `computeCombatXP()` — Enemy CR → Total XP

```
function computeCombatXP(enemyCRs: number[]): number

  1. Validate: enemyCRs.length >= 1 (caller guaranteed via Zod).
  2. Return sum of xpForCR(cr) for each cr in enemyCRs.
     // No encounter multiplier — the multiplier is for encounter *building*,
     // not for XP *awards* (5e 2014 SRD p. 260: "XP Thresholds by Character Level").
```

**Design note:** The encounter multiplier from `encounters.ts` is **not** applied to XP awards. Per 5e RAW (DMG p. 260), the multiplier adjusts difficulty calculation, not XP payout. Each monster's XP is awarded individually as listed in the CR/XP table.

### 5.3. `computeExplorationXP()` — Event → XP

```
function computeExplorationXP(event: ExplorationXPEvent): number

  Return EXPLORATION_XP[event]
```

Trivially pure. The constant lookup ensures consistent values.

### 5.4. `buildLevelUpPayload()` — Orchestrator

```
function buildLevelUpPayload(input: {
  characterId: string;
  className: CharacterClass;
  previousLevel: number;
  newLevel: number;
  currentMaxHp: number;
  conModifier: number;
  useAverage?: boolean;
}): LevelUpPayload

  1. hitDie = HIT_DIE_MAP[input.className]
  2. { hpRoll, hpGained } = rollHitPointGain(input.className, input.conModifier, input.useAverage)
  3. newMaxHp = input.currentMaxHp + hpGained
  4. newHitDiceTotal = input.newLevel  // 5e: hit dice count = character level

  Return {
    characterId: input.characterId,
    previousLevel: input.previousLevel,
    newLevel: input.newLevel,
    hitDie: "1d" + hitDie,
    hpRoll,
    conModifier: input.conModifier,
    hpGained,
    previousMaxHp: input.currentMaxHp,
    newMaxHp,
    newHitDiceTotal,
    className: input.className,
  }
```

This function assembles the complete payload for both the AI response and the UI overlay. It is **nearly pure** — randomness only enters via `rollHitPointGain()`.

### 5.5. AI Tool Integration — `triggerLevelUp`

Add to `buildTools()` in `lib/ai/narrator.ts`:

```typescript
triggerLevelUp: tool({
  description:
    "Resolve the mechanical effects of a character level-up. " +
    "MUST be called immediately after `awardXP` returns `leveledUp: true`. " +
    "Rolls the class-specific hit die + CON modifier to determine HP gained, " +
    "updates maxHp, hp, level, and hit dice in the database, " +
    "and returns the full LevelUpPayload for narration. " +
    "NEVER invent HP increases, stat changes, or level-up effects without calling this tool. " +
    "Code is Law.",
  inputSchema: TriggerLevelUpInputSchema,
  execute: async ({ characterId, useAverage }) => {
    // 1. Fetch character from DB: class, level, maxHp, hp, stats, hitDiceTotal
    // 2. Guard: character must have just leveled up (verify level matches expected)
    // 3. Parse className as CharacterClass
    // 4. Compute CON modifier from stats.CON via abilityModifier()
    // 5. Call buildLevelUpPayload({
    //      characterId, className, previousLevel: level - 1, newLevel: level,
    //      currentMaxHp: maxHp, conModifier, useAverage
    //    })
    // 6. Validate payload against LevelUpPayloadSchema
    // 7. Prisma transaction:
    //    a. Update Character.maxHp = payload.newMaxHp
    //    b. Update Character.hp = payload.newMaxHp  (full heal on level-up)
    //    c. Update Character.hitDiceTotal = payload.newHitDiceTotal
    //    d. Update Character.hitDiceRemaining = payload.newHitDiceTotal (reset)
    // 8. Return LevelUpPayload JSON
  },
})
```

### 5.6. Upgrade Existing `awardXP` Tool — Level-Up Prompt

The existing `awardXP` tool already updates `Character.xp` and `Character.level` and returns `{ ok, newXP, newLevel, leveledUp, reason }`. **No structural change needed.**

However, the Iron Laws mandate must be updated so the AI knows to follow an `awardXP` call (where `leveledUp: true`) with a mandatory `triggerLevelUp` call.

### 5.7. Combat XP Guidance in Formatter

Add a helper function to `lib/memory/formatter.ts` that injects combat XP guidance into the Victory section:

```
// Update the existing victory section in formatEncounter():
// After "MANDATORY: Call `generateLoot` with encounterId..."
// Add: "After loot, call `awardXP` with the total Combat XP for this encounter."
// The formatter should include the sum of all enemy CRs in the prompt so the AI
// can compute the XP amount. However, the AI uses the `awardXP` tool's `amount` parameter
// directly — it does NOT need to call a separate `computeCombatXP` function.
```

**Key design decision:** The AI narrator calls `awardXP` with a manually determined `amount` parameter (informed by the CR/XP guidance in the system prompt). We do **not** create a separate `awardCombatXP` tool — keeping tool count minimal. The `computeCombatXP()` pure function serves two purposes:
1. Used in unit tests to verify correct XP values for encounters.
2. Available for future automation where the narrator's XP calculation is validated server-side.

### 5.8. Formatter Updates

#### Update `formatIronLaws()` — add Level-Up Generation Mandate:

```
"**Level-Up Generation Mandate:** When `awardXP` returns `leveledUp: true`, " +
"you MUST immediately call `triggerLevelUp` with the character's ID. " +
"NEVER narrate HP increases, stat changes, new abilities, or level-up effects " +
"without the corresponding tool response. The tool rolls the class-specific hit die, " +
"computes the HP gain, and persists all changes. " +
"After calling `triggerLevelUp`, narrate the level-up as a significant in-world moment — " +
"muscles hardening, reflexes quickening, divine favor enveloping the character. " +
"Never say 'you leveled up' — describe the *feeling* of ascending. " +
"Code is Law."
```

#### Update `formatCharacter()` — add hit dice display:

```
// After the XP progress line, add:
"**Hit Dice:** [hitDiceRemaining]/[hitDiceTotal] d[hitDie]"

// Example: "**Hit Dice:** 3/5 d10"
```

This requires `hitDiceRemaining`, `hitDiceTotal`, and the class-derived hit die size to be available in `ContextCharacter`.

#### Update `formatEncounter()` — Victory section XP guidance:

```
// Within the "VICTORY — Encounter Resolved" section:
// After the mandatory `generateLoot` line, add:
"**Then call `awardXP`** with the combat XP for this encounter. " +
"Compute the total from the defeated enemies' Challenge Ratings."
```

### 5.9. Context Updates

Extend `ContextCharacter` in `lib/memory/context.ts`:

```typescript
export interface ContextCharacter {
  // ... existing fields ...

  /** Total hit dice the character possesses (= level). */
  hitDiceTotal: number;
  /** Remaining hit dice available for short rest healing. */
  hitDiceRemaining: number;
}
```

Update `buildCampaignContext()` to include these two new fields in the character select:

```typescript
// Inside the character select clause, add:
hitDiceTotal: true,
hitDiceRemaining: true,
```

### 5.10. Exploration XP Integration — `moveToNode` Enhancement

Update the `moveToNode` tool in `narrator.ts` to return exploration XP event type hints in its response:

```
// After a successful move, check the destination node's feature and the
// edge's passage type. Include an `explorationXPHint` field in the response:
//
// {
//   ...existingMoveResponse,
//   explorationXPHints: [
//     { event: "node_discovery", amount: 25, reason: "First visit to The Hollow Oak" },
//     { event: "hazard_survived", amount: 100, reason: "Survived the collapsing gallery" },
//   ]
// }
//
// The AI narrator MUST then call awardXP for each hint.
// This keeps XP awards explicit and auditable.
```

**Design note:** We embed XP hints in the `moveToNode` response rather than auto-awarding, because the AI may want to narrate the discovery before granting XP. The "push" model (hints → AI calls `awardXP`) preserves the existing tool pipeline and keeps the narrator in the loop.

### 5.11. Slice 2 Task Breakdown

| Task | File | Type | Depends On |
|------|------|------|------------|
| 2.1 Import `CharacterClass` from `proficiency.ts` in `progression.ts` | `lib/rules/progression.ts` | Import | Slice 1 |
| 2.2 Implement `rollHitPointGain(className, conModifier, useAverage?)` | `lib/rules/progression.ts` | Pure fn | 1.3 |
| 2.3 Implement `computeCombatXP(enemyCRs)` | `lib/rules/progression.ts` | Pure fn | — |
| 2.4 Implement `computeExplorationXP(event)` | `lib/rules/progression.ts` | Pure fn | 1.4 |
| 2.5 Implement `buildLevelUpPayload(input)` orchestrator | `lib/rules/progression.ts` | Pure fn | 2.2 |
| 2.6 Write comprehensive unit tests for `rollHitPointGain()` | `tests/rules/progression.test.ts` | Tests | 2.2 |
| 2.7 Unit test: `rollHitPointGain` always returns `hpGained >= 1` even with CON -5 | `tests/rules/progression.test.ts` | Test | 2.2 |
| 2.8 Unit test: `rollHitPointGain` useAverage produces correct averages for all 12 classes | `tests/rules/progression.test.ts` | Test | 2.2 |
| 2.9 Write unit tests for `computeCombatXP()` | `tests/rules/progression.test.ts` | Tests | 2.3 |
| 2.10 Unit test: `computeCombatXP` matches the DMG CR/XP table for known CRs | `tests/rules/progression.test.ts` | Test | 2.3 |
| 2.11 Write unit tests for `computeExplorationXP()` | `tests/rules/progression.test.ts` | Tests | 2.4 |
| 2.12 Write unit tests for `buildLevelUpPayload()` | `tests/rules/progression.test.ts` | Tests | 2.5 |
| 2.13 Unit test: `buildLevelUpPayload` correctly increments maxHp and hitDiceTotal | `tests/rules/progression.test.ts` | Test | 2.5 |
| 2.14 Unit test: `buildLevelUpPayload` validates against `LevelUpPayloadSchema` | `tests/rules/progression.test.ts` | Test | 2.5, 1.6 |
| 2.15 Add `triggerLevelUp` tool to `buildTools()` in narrator | `lib/ai/narrator.ts` | Tool | 2.5, Slice 1 |
| 2.16 Implement `triggerLevelUp` execute function (compute → persist → return) | `lib/ai/narrator.ts` | Async | 2.15 |
| 2.17 Add Level-Up Generation Mandate to `formatIronLaws()` | `lib/memory/formatter.ts` | Pure fn | — |
| 2.18 Update `formatCharacter()` to display hit dice | `lib/memory/formatter.ts` | Pure fn | — |
| 2.19 Update `formatEncounter()` Victory section with combat XP guidance | `lib/memory/formatter.ts` | Pure fn | — |
| 2.20 Update `ContextCharacter` type + `buildCampaignContext()` to include hitDice fields | `lib/memory/context.ts` | Async | 1.1 |
| 2.21 Update `moveToNode` tool to include `explorationXPHints` in response | `lib/ai/narrator.ts` | Tool update | — |
| 2.22 Write formatter tests for Level-Up Mandate and hit dice display | `tests/memory/formatter.test.ts` | Tests | 2.17, 2.18 |
| 2.23 Write formatter tests for Victory section XP guidance | `tests/memory/formatter.test.ts` | Tests | 2.19 |

### 5.12. Acceptance Criteria

- [ ] `rollHitPointGain()` returns correct die size for all 12 classes.
- [ ] `rollHitPointGain()` guarantees `hpGained >= 1` for all inputs (including CON -5).
- [ ] `rollHitPointGain()` average mode matches PHB "average" column: `ceil(hitDie/2) + 1`.
- [ ] `computeCombatXP()` returns the correct sum for known CR arrays.
- [ ] `computeExplorationXP()` returns the correct value for all 7 event types.
- [ ] `buildLevelUpPayload()` produces a valid `LevelUpPayload` for all class/level combinations.
- [ ] `buildLevelUpPayload()` correctly increments `maxHp` by at least 1.
- [ ] `triggerLevelUp` tool updates `Character.maxHp`, `Character.hp`, `Character.hitDiceTotal`, and `Character.hitDiceRemaining` in the database.
- [ ] `triggerLevelUp` tool restores HP to full (`hp = newMaxHp`) on level-up.
- [ ] Level-Up Generation Mandate appears in Iron Laws output.
- [ ] `formatCharacter()` displays hit dice remaining/total.
- [ ] Victory section includes combat XP guidance.
- [ ] `moveToNode` response includes `explorationXPHints` array when applicable.
- [ ] `pnpm test` passes.
- [ ] `pnpm tsc --noEmit` passes.

---

## 6. Slice 3 — VTT Ascension UI: "The Forge Overlay"

**Priority:** P1 — Enhances the progression experience after mechanics are solid.
**Philosophy:** Cinematic → Clear → Confirming, in that order.

### 6.1. Component: `AscensionOverlay.tsx`

`components/character/AscensionOverlay.tsx`

A React overlay component that renders when a level-up event occurs. The component:

1. **Overlays the entire VTT** with a semi-transparent dark backdrop and a centered "Forge" panel.
2. **Animates entry** with a radiant pulse / particle effect emanating from the center (CSS keyframes — no external animation library).
3. **Displays the level-up summary:**
   - Character name and class
   - `Level [previousLevel] → Level [newLevel]`
   - Hit Die rolled: `1d[X] → [hpRoll]` (or "Average" if `useAverage`)
   - CON modifier: `+[conModifier]`
   - `HP gained: +[hpGained]`
   - `Max HP: [previousMaxHp] → [newMaxHp]`
   - Hit Dice Total: `[newHitDiceTotal]`
4. **Shows a confirmation button:** "Accept the Forge's Gift" (diegetic label).
5. **On confirmation:** Dismisses the overlay and allows the game to continue.
6. **Dark-fantasy aesthetic:** Uses the existing dark theme tokens (slate/amber palette), with golden accent for the level number and a subtle ember particle animation.

### 6.2. Visual Design Specification

```
┌──────────────────────────────────────────────────────────────────┐
│  ░░░░░░░░░░░░░░░░░ SEMI-TRANSPARENT OVERLAY ░░░░░░░░░░░░░░░░░░ │
│  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │
│  ░░░░  ┌────────────────────────────────────────────────┐  ░░░░ │
│  ░░░░  │                                                │  ░░░░ │
│  ░░░░  │          ⚔️ THE FORGE ACCEPTS YOU ⚔️           │  ░░░░ │
│  ░░░░  │                                                │  ░░░░ │
│  ░░░░  │     Aldric the Unyielding — Fighter            │  ░░░░ │
│  ░░░░  │                                                │  ░░░░ │
│  ░░░░  │     Level 4  ─────►  Level 5                   │  ░░░░ │
│  ░░░░  │                                                │  ░░░░ │
│  ░░░░  │     ┌──────────────────────────────────┐       │  ░░░░ │
│  ░░░░  │     │  Hit Die:  1d10  →  rolled 7     │       │  ░░░░ │
│  ░░░░  │     │  CON mod:  +2                    │       │  ░░░░ │
│  ░░░░  │     │  HP Gained: +9                   │       │  ░░░░ │
│  ░░░░  │     │                                  │       │  ░░░░ │
│  ░░░░  │     │  Max HP:  36  →  45              │       │  ░░░░ │
│  ░░░░  │     │  Hit Dice: 5d10                  │       │  ░░░░ │
│  ░░░░  │     └──────────────────────────────────┘       │  ░░░░ │
│  ░░░░  │                                                │  ░░░░ │
│  ░░░░  │          ┌─────────────────────────┐           │  ░░░░ │
│  ░░░░  │          │ Accept the Forge's Gift │           │  ░░░░ │
│  ░░░░  │          └─────────────────────────┘           │  ░░░░ │
│  ░░░░  │                                                │  ░░░░ │
│  ░░░░  └────────────────────────────────────────────────┘  ░░░░ │
│  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │
└──────────────────────────────────────────────────────────────────┘
```

### 6.3. Component Props

```typescript
interface AscensionOverlayProps {
  /** The level-up payload returned by the triggerLevelUp tool. */
  payload: LevelUpPayload;
  /** Callback when the player acknowledges the level-up. */
  onAccept: () => void;
  /** Whether the overlay is visible. */
  isOpen: boolean;
}
```

### 6.4. CSS Requirements

- **Backdrop:** `position: fixed; inset: 0; background: rgba(0, 0, 0, 0.85); z-index: 1000;`
- **Forge Panel:** `background: var(--color-surface-elevated);` with `border: 1px solid var(--color-amber-600);`
- **Level number:** `color: var(--color-amber-400); font-size: 3rem; font-weight: 900;`
- **Entry animation:** `@keyframes forge-pulse` — a radiant golden pulse that fades from the center.
- **HP gain number:** `color: var(--color-green-400);` to signify positive change.
- **Confirmation button:** Amber/gold gradient with hover glow effect.
- **Responsive:** Panel max-width `500px`, centered vertically and horizontally.

### 6.5. XP Progress Bar Component

`components/character/XPProgressBar.tsx`

A secondary component that displays the character's XP progress toward the next level:

```
[████████████░░░░░░░░] 2700 / 6500 XP — Level 4
```

- Uses the existing `xpForLevel()` function to compute the target.
- Amber fill on dark track.
- Integrated into the campaign page's character panel.
- Animates smoothly when XP is awarded.

### 6.6. Game Event Handler Integration

The `triggerLevelUp` tool response must be intercepted by the client-side game event handler:

```
// In the campaign page's message stream handler:
// When a tool_result contains a LevelUpPayload (detected by
// checking for the `newLevel` + `hpGained` + `hitDie` fields):
//
// 1. Parse the payload against LevelUpPayloadSchema.
// 2. Set React state: setAscensionPayload(payload).
// 3. Set isAscensionOpen = true.
// 4. The AscensionOverlay renders.
// 5. On "Accept", set isAscensionOpen = false and continue.
```

### 6.7. Accessibility Requirements

- Focus traps to the overlay when open.
- Escape key dismisses the overlay (equivalent to accepting).
- All stat changes have `aria-live="polite"` for screen reader announcement.
- Confirmation button has descriptive `aria-label`.

### 6.8. Slice 3 Task Breakdown

| Task | File | Type | Depends On |
|------|------|------|------------|
| 3.1 Create `AscensionOverlay.tsx` with props interface | `components/character/AscensionOverlay.tsx` | Component | Slice 2 |
| 3.2 Implement overlay backdrop + forge panel layout | `components/character/AscensionOverlay.tsx` | CSS/JSX | 3.1 |
| 3.3 Implement `@keyframes forge-pulse` entry animation | CSS | Animation | 3.2 |
| 3.4 Implement level-up summary display (level, HP, hit dice) | `components/character/AscensionOverlay.tsx` | JSX | 3.1 |
| 3.5 Implement "Accept the Forge's Gift" confirmation button | `components/character/AscensionOverlay.tsx` | JSX | 3.4 |
| 3.6 Create `XPProgressBar.tsx` component | `components/character/XPProgressBar.tsx` | Component | — |
| 3.7 Implement smooth XP bar animation on value change | `components/character/XPProgressBar.tsx` | CSS | 3.6 |
| 3.8 Integrate `XPProgressBar` into campaign page character panel | `app/campaign/[id]/page.tsx` | Integration | 3.6 |
| 3.9 Add `LevelUpPayload` detection in message stream handler | `app/campaign/[id]/page.tsx` | Logic | Slice 2 |
| 3.10 Wire `AscensionOverlay` state management (open/close) | `app/campaign/[id]/page.tsx` | State | 3.1, 3.9 |
| 3.11 Implement focus trap + escape key handler | `components/character/AscensionOverlay.tsx` | A11y | 3.5 |
| 3.12 Write component tests for `AscensionOverlay` | `tests/components/AscensionOverlay.test.tsx` | Tests | 3.1–3.5 |
| 3.13 Write component tests for `XPProgressBar` | `tests/components/XPProgressBar.test.tsx` | Tests | 3.6 |
| 3.14 Accessibility audit: ARIA labels, focus management, keyboard nav | — | A11y | 3.11 |

### 6.9. Acceptance Criteria

- [ ] `AscensionOverlay` renders with all `LevelUpPayload` fields displayed.
- [ ] Overlay backdrop covers the full viewport with 85% opacity.
- [ ] Forge panel is centered vertically and horizontally with max-width 500px.
- [ ] Entry animation plays on mount (golden pulse effect).
- [ ] "Accept the Forge's Gift" button dismisses the overlay via `onAccept()`.
- [ ] Escape key also dismisses the overlay.
- [ ] `XPProgressBar` displays correct fill ratio based on `xp / xpForLevel(level + 1)`.
- [ ] XP bar animates smoothly on value change (CSS transition).
- [ ] Focus is trapped within the overlay when open.
- [ ] All interactive elements have descriptive `aria-label` attributes.
- [ ] `pnpm test` passes.
- [ ] `pnpm tsc --noEmit` passes.

---

## 7. File Change Summary

| File | Action | Description |
|------|--------|-------------|
| `prisma/schema.prisma` | **MODIFY** | Add `hitDiceTotal`, `hitDiceRemaining` to Character |
| `lib/rules/progression.ts` | **MODIFY** | Add `HIT_DIE_MAP`, `EXPLORATION_XP`, `rollHitPointGain()`, `computeCombatXP()`, `computeExplorationXP()`, `buildLevelUpPayload()`, Zod schemas |
| `lib/ai/narrator.ts` | **MODIFY** | Add `triggerLevelUp` tool; update `moveToNode` to include XP hints |
| `lib/memory/formatter.ts` | **MODIFY** | Add Level-Up Generation Mandate to Iron Laws; update `formatCharacter()` for hit dice; update Victory section |
| `lib/memory/context.ts` | **MODIFY** | Add `hitDiceTotal`, `hitDiceRemaining` to `ContextCharacter`; update `buildCampaignContext()` select |
| `components/character/AscensionOverlay.tsx` | **NEW** | Cinematic level-up celebration overlay |
| `components/character/XPProgressBar.tsx` | **NEW** | XP progress bar toward next level |
| `app/campaign/[id]/page.tsx` | **MODIFY** | Integrate `AscensionOverlay`, `XPProgressBar`, LevelUpPayload detection |
| `tests/rules/progression.test.ts` | **MODIFY** | Add tests for all new pure functions and Zod schemas |
| `tests/memory/formatter.test.ts` | **MODIFY** | Add tests for Level-Up Mandate, hit dice display, Victory XP guidance |
| `tests/components/AscensionOverlay.test.tsx` | **NEW** | Component tests for the overlay |
| `tests/components/XPProgressBar.test.tsx` | **NEW** | Component tests for the XP bar |

---

## 8. Execution Order for Claude Code CLI

```
Slice 1 → Slice 2 → Slice 3

Each slice MUST pass:
  1. pnpm tsc --noEmit (type safety)
  2. pnpm test (full suite green)

before proceeding to the next slice.
```

---

## 9. Cross-References

- **Milestone J** — Combat engine: `resolveEncounterEnd()`, `computeConsequences()`, `ComputeConsequencesInput`
- **Milestone K-A** — Loot system: `generateLoot` tool, Victory trigger in formatter
- **Milestone K-B** — Exploration system: `generateLocation`, `moveToNode` tools, `LocationNode.feature`, `LocationEdge.passageType`
- **PROJECT_CONTEXT.md** — §4 (Code is Law), §5 (Test Coverage), §25 (Precedence Order)
