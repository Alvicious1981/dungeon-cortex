# Milestone K — Track A: "The Spoils of War" — Dynamic Loot & Economy Generation

> **Precedence:** This document is subordinate to `PROJECT_CONTEXT.md` §25 (Precedence Order) and explicit user instructions.
> **Status:** Approved for execution — slice by slice.
> **Prerequisite:** Milestone J (Tactical Combat & VTT) — confirmed 100% closed and committed to git.

---

## 1. Objective

Implement a **Dynamic Loot & Economy Generation** system that activates automatically when the combat engine resolves a Victory. The system:

1. Detects the **Victory** beat when `resolveEncounterEnd()` returns `{ shouldEnd: true, reason: "all_enemies_dead" }`.
2. Forces the AI narrator to call a new `generateLoot` tool — the narrator **may NOT** invent loot, gold values, or item rarities on its own.
3. Uses the encounter's **Tension Score** (computed in Milestone J) as the primary input to determine loot rarity, quantity, and value.
4. Persists all generated loot into a **Party Inventory** and **Wealth** ledger via Prisma — not via narrative fiat.
5. Surfaces the spoils through a dedicated **"Spoils of War"** VTT overlay component with dark-fantasy aesthetics.

### Design Pillars (inherited from PROJECT_CONTEXT.md)

| Pillar | Application in Milestone K |
|---|---|
| **Code is Law** | Prisma handles all loot state. The AI narrator may describe the treasure, but it CANNOT invent gold amounts, item names, or rarity tiers. The `generateLoot` tool is the single source of truth. |
| **Readability beats spectacle** | The Spoils of War overlay must clearly communicate what was received. Loot clarity > animation extravagance. |
| **Diegetic immersion** | Loot items carry evocative names and brief descriptions that reinforce the world — "a corroded iron ring pulsing with faint warmth" not "Ring +1". |
| **100% Test Coverage Requirement** | Every pure function must have comprehensive unit tests. Every Zod schema must have validation tests. No slice is complete until `pnpm test` passes with full coverage of the new code. |

---

## 2. Core Loop — Victory → Loot → Persist → Display

```
  resolveAttack() → target HP drops to 0
          │
          ▼
  resolveEncounterEnd() returns { shouldEnd: true, reason: "all_enemies_dead" }
          │
          ▼
  Combat beat transitions to "aftermath"
          │
          ▼
  AI Narrator receives system prompt:
    "VICTORY. All enemies are dead. You MUST call `generateLoot` now."
          │
          ▼
  AI calls tool: generateLoot({ encounterId, tensionScore })
          │
          ▼
  ┌───────────────────────────────────────────────────────┐
  │              lib/rules/loot.ts (pure)                 │
  │                                                       │
  │  1. tensionScore → rarityBracket (mundane/uncommon/   │
  │     rare/very_rare/legendary)                         │
  │  2. rollGoldReward(tensionScore, enemyCount, avgCR)   │
  │  3. rollMundaneItems(tensionScore)                    │
  │  4. rollMagicItems(rarityBracket, tensionScore)       │
  │  5. assembleLootPayload() → LootPayload               │
  └───────────────────┬───────────────────────────────────┘
                      │
                      ▼
          ┌─────────────────────────┐
          │    LootPayload (JSON)    │
          │                         │
          │  gold: number            │
          │  mundaneItems: Item[]    │
          │  magicItems: Item[]      │
          │  totalValue: number      │
          │  rarityBracket: string   │
          │  flavorText: string      │
          └──────────┬──────────────┘
                     │
                     ▼
          Prisma transaction:
            1. Update Campaign.gold += gold
            2. Create InventoryItem[] for each item
            3. Mark Encounter as "resolved"
                     │
                     ▼
          Tool returns LootPayload to AI
                     │
                     ▼
          AI narrates the spoils using the payload
          (MUST use item names + descriptions verbatim)
                     │
                     ▼
          UI: "Spoils of War" overlay renders over VTT
```

---

## 3. Existing Infrastructure Audit

### What exists (Milestone J baseline)

| Module | State | Relevance to Milestone K |
|--------|-------|--------------------------|
| `lib/rules/combat.ts` | `resolveEncounterEnd()` — detects `all_enemies_dead` | **Trigger point** — this is the Victory detection |
| `lib/rules/combat.ts` | `computeTension()` — returns `TensionState` with `score: 0.0–1.0` | **Primary input** — tension drives loot rarity/value |
| `lib/ai/narrator.ts` | `buildTools()` — tool registry for AI narrator | **Integration point** — new `generateLoot` tool goes here |
| `lib/memory/formatter.ts` | `formatIronLaws()` — narrator constraint system | **Update point** — add Loot Generation Mandate |
| `lib/rules/generators.ts` | `seededFloat()`, `pickSeeded()`, `mulberry32()` — deterministic PRNG | **Reuse** — loot tables use the same seeded randomization |
| `lib/rules/inventory.ts` | `InventoryItem` type, `equipItem()`, `validateItem()` | **Integration** — generated items must match this schema |
| `prisma/schema.prisma` | `Character`, `Campaign`, `InventoryItem`, `Encounter`, `Combatant` | **Update** — add `gold` to Campaign; loot items go into `InventoryItem` |
| `components/combat/CombatVTT.tsx` | VTT container component | **Integration** — Spoils of War overlay mounts here |

### What is missing

1. **Party Wealth/Gold tracking** — no `gold` column on Campaign.
2. **Loot generation engine** — no `lib/rules/loot.ts` exists.
3. **`generateLoot` AI tool** — the narrator has no way to award loot.
4. **Loot Generation Mandate** in Iron Laws — the AI is not yet constrained to use the loot tool.
5. **"Spoils of War" UI** — no overlay component for displaying post-combat rewards.
6. **Rarity system** — no rarity enum or tables for magic items.
7. **Loot tables** — no data files defining item pools by rarity tier.

---

## 4. Slice 1 — Data Layer

**Priority:** P0 — Must be first. All other slices depend on this.
**Philosophy:** Schema first, types second, validation third. No business logic in this slice.

### 4.1. Prisma Schema Updates

```prisma
model Campaign {
  // ... existing fields ...

  /// Party gold pieces. Integer — no fractional currency.
  /// Mutations ONLY via Prisma transactions from tool execution, never from AI narration.
  gold  Int  @default(0)
}
```

No other schema changes are required. Generated loot items are persisted as standard `InventoryItem` records linked to the player `Character`. The existing `InventoryItem` model with its `properties: Json` field and `type` discriminant is sufficient to hold all loot categories (weapon, armor, consumable, misc).

**Migration name:** `add_campaign_gold`

### 4.2. Loot Rarity System

Define in `lib/rules/loot.ts`:

```typescript
export type LootRarity =
  | "mundane"      // Common items, no magical properties
  | "uncommon"     // Minor magical items
  | "rare"         // Significant magical items
  | "very_rare"    // Powerful magical items
  | "legendary";   // Campaign-defining artifacts (tension ≥ 0.95 only)
```

### 4.3. Zod Schemas for Tool I/O

Define in `lib/rules/loot.ts`:

#### Input schema (for the `generateLoot` tool):

```typescript
export const GenerateLootInputSchema = z.object({
  encounterId: z.string().min(1),
  tensionScore: z
    .number()
    .min(0)
    .max(1)
    .describe(
      "The encounter's final Tension Score [0..1] from the Consequences Engine. " +
      "Drives rarity bracket and gold multiplier."
    ),
});

export type GenerateLootInput = z.infer<typeof GenerateLootInputSchema>;
```

#### Output payload:

```typescript
export const LootItemSchema = z.object({
  name: z.string(),
  type: z.enum(["weapon", "armor", "consumable", "misc"]),
  rarity: z.enum(["mundane", "uncommon", "rare", "very_rare", "legendary"]),
  description: z.string().max(200),
  properties: z.record(z.unknown()),
  valueGP: z.number().int().nonnegative(),
});

export type LootItem = z.infer<typeof LootItemSchema>;

export const LootPayloadSchema = z.object({
  gold: z.number().int().nonnegative(),
  mundaneItems: z.array(LootItemSchema),
  magicItems: z.array(LootItemSchema),
  totalValue: z.number().int().nonnegative(),
  rarityBracket: z.enum(["mundane", "uncommon", "rare", "very_rare", "legendary"]),
  flavorText: z.string().max(300),
});

export type LootPayload = z.infer<typeof LootPayloadSchema>;
```

### 4.4. Slice 1 Task Breakdown

| Task | File | Type | Depends On |
|------|------|------|------------|
| 1.1 Schema migration: add `gold` to Campaign | `prisma/schema.prisma` | Migration | — |
| 1.2 Run `pnpm prisma generate` to regenerate client | — | Command | 1.1 |
| 1.3 Define `LootRarity` type | `lib/rules/loot.ts` | Types | — |
| 1.4 Define `GenerateLootInputSchema` (Zod) | `lib/rules/loot.ts` | Schema | 1.3 |
| 1.5 Define `LootItemSchema` (Zod) | `lib/rules/loot.ts` | Schema | 1.3 |
| 1.6 Define `LootPayloadSchema` (Zod) | `lib/rules/loot.ts` | Schema | 1.5 |
| 1.7 Write unit tests for all Zod schemas (valid + invalid inputs, edge cases, boundary values) | `tests/rules/loot.test.ts` | Tests | 1.3–1.6 |
| 1.8 Type-check: `pnpm tsc --noEmit` | — | Validation | 1.1–1.6 |

### 4.5. Acceptance Criteria

- [ ] `Campaign.gold` column exists in the database and defaults to `0`.
- [ ] All Zod schemas parse valid inputs and reject malformed ones.
- [ ] Schema tests cover: zero gold, max boundary values, empty item arrays, invalid rarity strings, oversized descriptions.
- [ ] `pnpm test` passes.
- [ ] `pnpm tsc --noEmit` passes.

---

## 5. Slice 2 — The Loot Engine

**Priority:** P0 — Must complete before UI integration.
**Philosophy:** Pure math first, tool integration second. Every function deterministic given a seed.

### 5.1. Tension → Rarity Bracket Mapping

Define in `lib/rules/loot.ts` as a pure function:

```
function tensionToRarityBracket(tensionScore: number): LootRarity

  tensionScore < 0.20  →  "mundane"
  tensionScore < 0.40  →  "uncommon"
  tensionScore < 0.70  →  "rare"
  tensionScore < 0.95  →  "very_rare"
  tensionScore >= 0.95 →  "legendary"
```

The rarity bracket is the **ceiling** — the best possible item rarity. Individual items may roll lower within the bracket.

### 5.2. Gold Reward Formula

```
function rollGoldReward(tensionScore: number, enemyCount: number, avgCR: number): number

  baseGold = Math.floor(avgCR * 10 + enemyCount * 5)
  tensionMultiplier = 1.0 + tensionScore * 2.0    // [1.0 .. 3.0]
  variance = seededRandom in [0.8 .. 1.2]          // ±20% spread

  gold = Math.floor(baseGold * tensionMultiplier * variance)
  return Math.max(1, gold)   // minimum 1 GP
```

### 5.3. Mundane Item Generation

```
function rollMundaneItems(tensionScore: number, seed: number): LootItem[]

  count = tensionScore < 0.30 ? 1
        : tensionScore < 0.60 ? randInt(1, 2)
        : randInt(2, 3)

  For each item:
    pick from MUNDANE_LOOT_TABLE (data/loot-tables.json → mundane[])
    Each entry: { name, description, type, valueGP }
    Return as LootItem with rarity = "mundane"
```

### 5.4. Magic Item Generation

```
function rollMagicItems(rarityBracket: LootRarity, tensionScore: number, seed: number): LootItem[]

  if rarityBracket === "mundane":
    return []      // no magic items for trivial encounters

  count = rarityBracket === "uncommon" ? randInt(0, 1)
        : rarityBracket === "rare"     ? 1
        : rarityBracket === "very_rare" ? randInt(1, 2)
        : 1         // legendary: always exactly 1

  For each item:
    effectiveRarity = rollIndividualRarity(rarityBracket, seed)
    pick from MAGIC_ITEM_TABLE by effectiveRarity
    Each entry: { name, description, type, properties, valueGP }
    Return as LootItem

function rollIndividualRarity(ceiling: LootRarity, seed: number): LootRarity
    d100 = seededRandom [0..100)
    if ceiling === "legendary":
      d100 < 10  → "legendary"
      d100 < 35  → "very_rare"
      d100 < 70  → "rare"
      else       → "uncommon"
    if ceiling === "very_rare":
      d100 < 20  → "very_rare"
      d100 < 55  → "rare"
      else       → "uncommon"
    if ceiling === "rare":
      d100 < 30  → "rare"
      else       → "uncommon"
    if ceiling === "uncommon":
      return "uncommon"
```

### 5.5. Loot Table Data File

Create `data/loot-tables.json`:

```json
{
  "mundane": [
    {
      "name": "Tarnished copper bracelet",
      "description": "A thin band of hammered copper, green with age. Worth melting down.",
      "type": "misc",
      "valueGP": 1
    },
    {
      "name": "Cracked leather satchel",
      "description": "Sun-faded and split at the seams, but the buckle is still good.",
      "type": "misc",
      "valueGP": 2
    }
    // ... 20–30 curated entries across misc, consumable, weapon types
  ],
  "uncommon": [
    {
      "name": "Glowstone Pendant",
      "description": "A pale opal set in iron wire that emits a faint, steady light in darkness.",
      "type": "misc",
      "properties": { "effect": "dim_light_10ft" },
      "valueGP": 50
    }
    // ... 15–20 entries
  ],
  "rare": [
    {
      "name": "Blade of Bitter Resolve",
      "description": "A single-edged sword whose blade darkens when drawn in anger.",
      "type": "weapon",
      "properties": { "damageDice": "1d8", "damageBonus": 1, "damageType": "slashing" },
      "valueGP": 500
    }
    // ... 10–15 entries
  ],
  "very_rare": [
    {
      "name": "Voidclasp Gauntlet",
      "description": "Black iron gauntlet that absorbs ambient light. Strikes leave trails of shadow.",
      "type": "armor",
      "properties": { "baseAC": 1, "addDexModifier": false, "effect": "shadow_trail" },
      "valueGP": 2000
    }
    // ... 8–10 entries
  ],
  "legendary": [
    {
      "name": "The Hollow Crown",
      "description": "A circlet of bone-white metal. The wearer hears whispers of every monarch who wore it before.",
      "type": "misc",
      "properties": { "effect": "wisdom_advantage", "curse": "whispers" },
      "valueGP": 10000
    }
    // ... 3–5 entries (legendary must feel earned)
  ]
}
```

**Curation rule:** Each entry must have an evocative, diegetic name and a ≤200 char description that reinforces the dark fantasy tone. No "Sword +1" naming. Every item tells a micro-story.

### 5.6. Flavor Text Generator

```
function generateFlavorText(rarityBracket: LootRarity, gold: number, seed: number): string

  Pick from curated FLAVOR_TEXT_TABLE indexed by rarity:
    mundane:   "Pockets picked clean. A few coins and dust."
    uncommon:  "Something glints beneath the bloodstain. You reach..."
    rare:      "The air around the corpse hums with faint energy."
    very_rare: "The ground trembles. Something here does not belong in mortal hands."
    legendary: "A weight settles on your soul before your hand touches it."
```

### 5.7. Orchestrator — `generateLootPayload()`

```
function generateLootPayload(input: {
  tensionScore: number;
  enemyCount: number;
  avgCR: number;
  seed: number;
}): LootPayload

  1. rarityBracket = tensionToRarityBracket(input.tensionScore)
  2. gold = rollGoldReward(input.tensionScore, input.enemyCount, input.avgCR)
  3. mundaneItems = rollMundaneItems(input.tensionScore, input.seed)
  4. magicItems = rollMagicItems(rarityBracket, input.tensionScore, input.seed + 1)
  5. totalValue = gold + sum(mundaneItems.valueGP) + sum(magicItems.valueGP)
  6. flavorText = generateFlavorText(rarityBracket, gold, input.seed + 2)

  return { gold, mundaneItems, magicItems, totalValue, rarityBracket, flavorText }
```

This function is **pure** — given the same inputs and seed, it always produces the same output.

### 5.8. AI Tool Integration — `generateLoot`

Add to `buildTools()` in `lib/ai/narrator.ts`:

```typescript
generateLoot: tool({
  description:
    "Generate the loot reward for a resolved combat encounter. " +
    "MUST be called IMMEDIATELY after an encounter ends with all enemies dead. " +
    "The Tension Score from the encounter determines rarity and value. " +
    "Returns gold, mundane items, magic items, and flavor text. " +
    "You MUST narrate the loot using ONLY the returned item names, descriptions, " +
    "and gold amount — NEVER invent treasure or modify values.",
  inputSchema: GenerateLootInputSchema,
  execute: async ({ encounterId, tensionScore }) => {
    // 1. Fetch encounter + combatants from DB
    // 2. Guard: encounter must be in "resolved" or "all_enemies_dead" state
    // 3. Compute avgCR from enemy combatants (via SrdMonster lookup or stored data)
    // 4. Generate seed from encounterId (deterministic)
    // 5. Call generateLootPayload({ tensionScore, enemyCount, avgCR, seed })
    // 6. Prisma transaction:
    //    a. campaign.gold += payload.gold
    //    b. Create InventoryItem for each mundane + magic item
    // 7. Return LootPayload JSON
  },
})
```

### 5.9. Formatter Update — Loot Generation Mandate

Add to `formatIronLaws()` in `lib/memory/formatter.ts`:

```
"**Loot Generation Mandate:** When an encounter ends with all enemies dead, " +
"you MUST immediately call `generateLoot` with the encounter's Tension Score. " +
"NEVER invent gold amounts, item names, rarity levels, or magical properties. " +
"Narrate the discovered treasure using ONLY the `gold`, `mundaneItems`, and `magicItems` " +
"from the tool response. Use the `flavorText` as atmospheric framing. " +
"Item names and descriptions must appear verbatim — do not embellish or rename them. " +
"Code is Law."
```

### 5.10. Victory Trigger Integration

When `resolveEncounterEnd()` returns `{ shouldEnd: true, reason: "all_enemies_dead" }`, the system prompt injected via `formatEncounter()` must include a clear directive:

```markdown
## ⚔️ VICTORY — Encounter Resolved
All enemies have been defeated. Tension Score at encounter end: **0.73**

**MANDATORY:** Call `generateLoot` with encounterId and tensionScore NOW.
Do NOT narrate any loot or treasure until you have the tool response.
```

This section should be added to `formatEncounter()` when the encounter status transitions to `"resolved"` with reason `"all_enemies_dead"`.

### 5.11. Slice 2 Task Breakdown

| Task | File | Type | Depends On |
|------|------|------|------------|
| 2.1 Implement `tensionToRarityBracket()` | `lib/rules/loot.ts` | Pure fn | Slice 1 types |
| 2.2 Implement `rollGoldReward()` | `lib/rules/loot.ts` | Pure fn | — |
| 2.3 Create `data/loot-tables.json` with curated item pools (mundane through legendary) | `data/loot-tables.json` | Data | — |
| 2.4 Implement `rollMundaneItems()` | `lib/rules/loot.ts` | Pure fn | 2.3 |
| 2.5 Implement `rollIndividualRarity()` | `lib/rules/loot.ts` | Pure fn | — |
| 2.6 Implement `rollMagicItems()` | `lib/rules/loot.ts` | Pure fn | 2.3, 2.5 |
| 2.7 Implement `generateFlavorText()` | `lib/rules/loot.ts` | Pure fn | — |
| 2.8 Implement `generateLootPayload()` orchestrator | `lib/rules/loot.ts` | Pure fn | 2.1–2.7 |
| 2.9 Write comprehensive unit tests for all pure functions | `tests/rules/loot.test.ts` | Tests | 2.1–2.8 |
| 2.10 Add `generateLoot` tool to `buildTools()` in narrator | `lib/ai/narrator.ts` | Tool | 2.8, Slice 1 |
| 2.11 Implement tool execute function (DB fetch → generate → persist → return) | `lib/ai/narrator.ts` | Async | 2.10 |
| 2.12 Add Loot Generation Mandate to `formatIronLaws()` | `lib/memory/formatter.ts` | Pure fn | — |
| 2.13 Add Victory trigger section to `formatEncounter()` | `lib/memory/formatter.ts` | Pure fn | — |
| 2.14 Integration test: Victory → generateLoot → verify LootPayload + DB state | `tests/integration/loot.test.ts` | Test | 2.10–2.13 |

### 5.12. Acceptance Criteria

- [ ] `tensionToRarityBracket(0.0)` returns `"mundane"`, `tensionToRarityBracket(0.95)` returns `"legendary"`.
- [ ] `rollGoldReward()` always returns ≥ 1 GP.
- [ ] `rollMagicItems()` returns `[]` for `mundane` bracket — never awards magic items for trivial fights.
- [ ] `generateLootPayload()` returns a valid `LootPayload` object for every tension score [0..1].
- [ ] `generateLoot` tool creates `InventoryItem` records in the database.
- [ ] `Campaign.gold` is incremented via Prisma transaction, not narrative.
- [ ] The formatter Iron Laws include the Loot Generation Mandate.
- [ ] The formatter includes the Victory trigger section when encounter is resolved.
- [ ] All pure functions tested: every rarity bracket boundary, zero tension, max tension, single enemy, many enemies, low CR, high CR.
- [ ] `pnpm test` passes.
- [ ] `pnpm tsc --noEmit` passes.

---

## 6. Slice 3 — VTT UI Integration: "Spoils of War" Overlay

**Priority:** P1 — Enhances the post-combat experience after mechanics are solid.
**Philosophy:** Clear → Atmospheric → Animated, in that order.

### 6.1. Component: `SpoilsOfWar.tsx`

`components/combat/SpoilsOfWar.tsx`

An overlay panel that renders over the VTT grid (via `CombatVTT.tsx`) when combat ends with a victory. The overlay:

1. **Fades in** with a dark, semi-transparent backdrop (rgba(0,0,0,0.85)) over the battle grid.
2. **Displays a header** styled like a parchment unfurling: "⚔️ The Spoils of War".
3. **Shows the rarity bracket** as a colored badge:
   - `mundane` — iron grey
   - `uncommon` — verdigris green
   - `rare` — deep sapphire blue
   - `very_rare` — amethyst purple
   - `legendary` — molten gold with subtle glow animation
4. **Lists gold received** with a coin icon and the amount in GP.
5. **Lists each mundane item** with:
   - Item name (bold)
   - Description (italic, muted)
   - Value in GP
6. **Lists each magic item** (if any) with:
   - Item name (bold, colored by rarity)
   - Rarity badge (small chip)
   - Description (italic)
   - Value in GP
7. **Displays the flavor text** at the bottom in a quotation block.
8. **Includes a "Claim & Continue" button** that dismisses the overlay and returns to the narrative view.

### 6.2. Visual Design Specification

```
┌──────────────────────────────────────────────┐
│ ░░░░░░░░░░░░░ dark backdrop ░░░░░░░░░░░░░░░ │
│                                              │
│        ⚔️  THE SPOILS OF WAR  ⚔️             │
│        ───────────────────────               │
│                                              │
│        ┌─ RARE ─┐  (rarity badge)            │
│        └────────┘                            │
│                                              │
│        💰  42 Gold Pieces                    │
│                                              │
│        ── Mundane Items ──                   │
│        • Tarnished copper bracelet           │
│          A thin band of hammered copper...   │
│                                        1 GP  │
│        • Cracked leather satchel             │
│          Sun-faded and split at...           │
│                                        2 GP  │
│                                              │
│        ── Magic Items ──                     │
│        ★ Blade of Bitter Resolve  [RARE]     │
│          A single-edged sword whose blade... │
│                                      500 GP  │
│                                              │
│        ┌──────────────────────────┐          │
│        │ "The air around the      │          │
│        │  corpse hums with faint  │          │
│        │  energy."                │          │
│        └──────────────────────────┘          │
│                                              │
│        ┌─────────────────────────┐           │
│        │   ⚔️ Claim & Continue   │           │
│        └─────────────────────────┘           │
│                                              │
└──────────────────────────────────────────────┘
```

### 6.3. CSS Styling

The Spoils of War overlay uses the existing dark-fantasy palette from `app/globals.css`:

- Background: `rgba(10, 10, 14, 0.92)` — near-black with slight transparency to hint at the battlefield behind.
- Text: `hsl(40 15% 85%)` — warm parchment white.
- Item names: `hsl(40 30% 70%)` — antique gold.
- Rarity colors (for badges and magic item names):
  - mundane: `hsl(0 0% 50%)`
  - uncommon: `hsl(145 40% 45%)`
  - rare: `hsl(215 60% 50%)`
  - very_rare: `hsl(270 50% 55%)`
  - legendary: `hsl(40 100% 55%)` with `text-shadow: 0 0 8px hsl(40 100% 55% / 0.5)`

### 6.4. Animation Specification

- **Overlay entrance:** fade-in over 400ms, `ease-out`.
- **Gold amount:** count-up animation from 0 to final value over 800ms.
- **Item list:** staggered fade-in, 100ms delay between items.
- **Legendary items:** subtle pulse glow on the rarity badge (CSS `@keyframes pulse`).
- **reduced-motion:** all animations disabled via `prefers-reduced-motion: reduce`.

### 6.5. Integration with CombatVTT

The `SpoilsOfWar` component mounts as a conditional overlay inside `CombatVTT.tsx`:

```
{lootPayload && (
  <SpoilsOfWar
    payload={lootPayload}
    onClaim={() => setLootPayload(null)}
  />
)}
```

The `GameEventHandler` component listens for the `generateLoot` tool response and sets the `lootPayload` state to trigger the overlay.

### 6.6. Accessibility Requirements

- **Focus trap** — keyboard focus is trapped in the overlay while it's open.
- **ARIA role** — `role="dialog"`, `aria-labelledby` pointing to the header, `aria-modal="true"`.
- **Screen reader** — all loot items announced via live region on overlay open.
- **Keyboard** — `Escape` key dismisses the overlay (same as clicking "Claim & Continue").
- **Contrast** — all text meets WCAG AA contrast minimums against the dark backdrop.

### 6.7. Slice 3 Task Breakdown

| Task | File | Type | Depends On |
|------|------|------|------------|
| 3.1 Create `SpoilsOfWar.tsx` — overlay component | `components/combat/SpoilsOfWar.tsx` | React | Slice 2 types |
| 3.2 Add CSS for Spoils overlay — dark fantasy palette, rarity colors, animations | `app/globals.css` or CSS module | CSS | — |
| 3.3 Add gold count-up animation and staggered item reveal | `components/combat/SpoilsOfWar.tsx` | React | 3.1 |
| 3.4 Add legendary glow pulse animation | CSS | CSS | 3.2 |
| 3.5 Integrate `SpoilsOfWar` into `CombatVTT.tsx` as conditional overlay | `components/combat/CombatVTT.tsx` | React | 3.1 |
| 3.6 Update `GameEventHandler.tsx` to capture `generateLoot` tool response and trigger overlay | `components/combat/GameEventHandler.tsx` | React | Slice 2 |
| 3.7 Accessibility pass — focus trap, ARIA roles, keyboard dismiss, reduced-motion | `components/combat/SpoilsOfWar.tsx` | A11Y | 3.1 |
| 3.8 Manual UI smoke test — complete an encounter, verify overlay renders with correct loot | — | Manual | 3.1–3.7 |

### 6.8. Acceptance Criteria

- [ ] The "Spoils of War" overlay renders when `generateLoot` returns a valid `LootPayload`.
- [ ] Gold, mundane items, and magic items display correctly with appropriate rarity colors.
- [ ] The "Claim & Continue" button dismisses the overlay cleanly.
- [ ] All animations respect `prefers-reduced-motion`.
- [ ] Focus is trapped within the overlay while it's open.
- [ ] `pnpm build` succeeds without errors.

---

## 7. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| AI narrator ignores `generateLoot` mandate and invents loot | Medium | High | Strong Iron Law constraint; post-hoc validation in future QA slice |
| Loot tables too sparse → repetitive rewards | Medium | Medium | Start with 60+ curated entries across all tiers; expand iteratively |
| Gold inflation breaks economy over long campaigns | Low | Medium | Gold formula bounded by enemy CR and tension; add spending sinks in future milestone |
| `InventoryItem.properties` JSON shape mismatch for generated items | Low | High | All generated items must pass `validateItem()` before DB insert |
| Legendary items too frequent at high tension | Low | Medium | d100 sub-roll within bracket ensures legendary is still <10% even at ceiling |
| Overlay blocks combat log and state — player confusion | Low | Low | Overlay is dismissible; combat state is already persisted before overlay renders |

---

## 8. Verification Plan

### Automated Tests

| Layer | What | Command |
|-------|------|---------|
| Unit | All Zod schemas + pure functions in Slices 1–2 | `pnpm vitest run tests/rules/loot.test.ts` |
| Type | Full project type-check | `pnpm tsc --noEmit` |
| Integration | generateLoot tool cycle: Victory → tool → DB state | `pnpm vitest run tests/integration/loot.test.ts` |
| Build | Production build | `pnpm build` |

### Manual Verification

| Check | Method |
|-------|--------|
| Loot generation correctness | Spawn encounter → defeat all enemies → verify `generateLoot` is called → inspect `LootPayload` in console |
| Gold persistence | Check `Campaign.gold` in database after loot generation — must match payload |
| Item persistence | Check `InventoryItem` records — names, types, properties must match payload |
| Spoils of War overlay | Visual inspection: renders correctly, animations work, dismisses cleanly |
| Rarity distribution | Run 100 loot generations at tension 0.5 — verify ~30% rare, ~55% uncommon, ~15% mundane magic items |
| Accessibility | Keyboard-only: Tab through overlay, Escape to dismiss. Screen reader: items announced. |

---

## 9. Dependencies Between Slices

```
Slice 1 (Data Layer)
    │
    ├──── Zod schemas + types ────► Slice 2 (Loot Engine)
    │                                    │
    │                                    ├──── generateLootPayload() ────► Slice 3 (VTT UI)
    │                                    │
    │                                    └──── generateLoot tool ─────► Slice 3 (GameEventHandler)
    │
    └──── Campaign.gold migration ────► Slice 2 (tool execute — DB writes)
```

**Execution order is strict:** Slice 1 → Slice 2 → Slice 3. No parallelization.

---

## 10. Future Extensions (Not in Milestone K, Track A Scope)

| Track | Feature | Blocked By |
|-------|---------|------------|
| K-B | Shop & Trade System — spend gold at NPC merchants | Track A (gold + inventory baseline) |
| K-C | Crafting System — combine loot into enhanced items | Track A (item properties baseline) |
| K-D | Cursed Items — some legendary loot carries narrative penalties | Track A (magic item system) |
| K-E | Loot Sharing — split rewards between party members | Future multiplayer milestone |
| K-F | Economy Balancing — inflation tracking, gold sinks, merchant pricing | Track A + B (full economy loop needed) |

---

## 11. Glossary

| Term | Definition |
|------|-----------|
| **LootPayload** | The structured JSON object returned by `generateLoot`, containing gold, items, rarity, and flavor text |
| **Rarity Bracket** | The maximum item rarity tier attainable for an encounter, derived from Tension Score |
| **Tension Score** | A [0..1] value from the Consequences Engine reflecting encounter danger (Milestone J) |
| **Victory Beat** | The "aftermath" combat beat triggered when all enemies reach 0 HP |
| **Party Wealth** | The `Campaign.gold` integer tracking accumulated gold pieces |
| **Flavor Text** | A curated atmospheric sentence describing the loot discovery moment |
| **Loot Table** | A `data/loot-tables.json` data file containing curated item pools indexed by rarity tier |
| **d100 Sub-Roll** | A secondary randomization within a rarity bracket that allows items to roll lower than the bracket ceiling |
