# Milestone J: Tactical VTT & Visceral Combat — Architectural Specification

> **Precedence:** This document is subordinate to `PROJECT_CONTEXT.md` §25 (Precedence Order) and explicit user instructions.  
> **Status:** Approved for execution — slice by slice.  
> **Prerequisite:** Milestone I (Dynamic World & Entities) — confirmed 100% closed.

---

## 1. Objective

Fuse a **Tactical Combat Engine** with the **Narrative Translation Layer** described in the design references, producing a combat system where:

1. Every mechanical result (hit, miss, crit, damage, death) is translated into a **structured JSON payload** consumed by the AI narrator.
2. The AI narrator is **constrained** to narrate only the facts the engine provides — no invented numbers, no invented locations, no invented effects.
3. The intensity and style of narration scales with a **computed gradient**, not a fixed template.
4. Combat proceeds in a **turn-based loop** built on top of the existing `spatial.ts` zone graph.
5. The VTT (Virtual Table Top) UI surfaces combat consequences with **visual feedback** — badges, beat markers, and zone-aware combatant positioning.

### Design Pillars (inherited from PROJECT_CONTEXT.md)

| Pillar | Application in Milestone J |
|---|---|
| **Code is Law** | The Consequences Engine is the single source of truth for combat facts, narrative tags, intensity, and beat. The AI may NOT override any of these values. |
| **Readability beats spectacle** | VTT visuals enhance clarity; they do not obscure the combat state. |
| **Diegetic immersion** | Narrative tags and beat markers reinforce the fiction — damage isn't a number, it's a *desgarro* or a *crack*. |

---

## 2. Design Reference Summary

Two design documents define the feature space:

### Reference A — `integracion_narrativa_en_combates.txt`
18 concrete improvements, of which the following are **in scope** for Milestone J:

| # | Feature | Scope |
|---|---------|-------|
| 1 | Consequences Engine (combat_facts → narrative_tags) | **Slice 1** — core |
| 2 | Narrative Intensity gradient [0..1] | **Slice 1** — core |
| 3 | Cinematic Beats (apertura → clímax → aftermath) | **Slice 1** — core |
| 4 | Hard-verb lexicon per damage type | **Slice 2** — prompt |
| 5 | Hit location + secondary effects | **Slice 1** — core |
| 6 | Environment reactions / hazards | Slice 4 (future) |
| 7 | Tension score [0..1] | **Slice 1** — core |
| 8 | Aftermath + persistent scars | Slice 4 (future) |
| 9 | Enemy perspective micro-beats | **Slice 2** — prompt |
| 10 | UI badges (SANGRADO, ROTURA, etc.) | **Slice 3** — VTT |
| 11 | Curated crit/fumble library | **Slice 1** — data |
| 12 | Senses quota + anti-repetition | **Slice 2** — prompt |
| 13 | Gore level (PG-13 / Mature) | **Slice 2** — prompt |
| 14 | Tactical hooks ("push", "disarm") | **Slice 2** — prompt |
| 15 | Finisher / mercy prompts | Slice 4 (future) |
| 16 | Style micro-DSL for AI prompt | **Slice 2** — prompt |
| 17 | Facts-to-prose transformation example | **Slice 2** — validation |
| 18 | Narrative QA metrics | Slice 5 (future) |

### Reference B — `Mejora de la Narrativa en Combates y su Integración`
High-level philosophy on narrative-combat integration: context, character development, objectives, environment, information reveal, consequence, cinematography, emotional weight. These principles inform the **system prompt tone** and the **beat system** but require no standalone code modules.

---

## 3. Existing Infrastructure Audit

### What exists (Milestone B / I baseline)

| Module | State | Coverage |
|--------|-------|----------|
| `lib/rules/combat.ts` | Initiative (rollInitiative), turn advance, damage application, encounter-end detection, AC derivation, attack roll resolution | Functions exist but `resolveAttackRoll` returns only hit/miss/crit/fumble — no damage, no location, no narrative payload |
| `lib/rules/spatial.ts` | Zone graph (canMove, calculateDistance, isWithinRange, moveCombatant) | Complete for movement validation; no combat integration |
| `lib/rules/encounters.ts` | CR/XP budget encounter builder | Complete — no changes needed |
| `lib/rules/dice.ts` | Roll parser ("1d20+5") | Complete — will be called by new damage roll functions |
| `lib/ai/narrator.ts` | Streaming narrative pipeline with tool definitions (spawnEncounter, etc.) | Needs new `resolveAttack` tool; prompt needs combat-fact injection |
| `lib/memory/formatter.ts` | System prompt builder (Iron Laws, character, encounter, quests, logs) | Needs combat-fact section, beat/intensity injection, style DSL block |
| `prisma/schema.prisma` | Encounter, Combatant, Zone models | No `hitLocation`, `narrativeTags`, or `combatBeat` columns yet |
| `components/combat/` | InitiativeTracker, MacroDeck, GameEventHandler | No VTT grid, no badge system, no beat markers |

### What is missing

1. **Consequences Engine** — the entire `combat_facts → narrative_tags → narrative_intensity → combat_beat` pipeline.
2. **Damage resolution** — `resolveAttackRoll` computes hit/miss but does not roll damage dice or compute overkill.
3. **Hit location system** — no tables exist.
4. **Narrative tag catalogue** — no data files.
5. **Turn-based combat loop (full)** — `advanceTurn` moves the pointer but there is no orchestrator that calls attack resolution → consequences → AI narration → state mutation in sequence.
6. **`resolveAttack` AI tool** — the AI has no way to resolve an attack as a tool call and receive the structured consequences payload.
7. **VTT grid renderer** — zones exist in schema but no React component renders them.
8. **Badge / beat marker UI** — does not exist.

---

## 4. Architecture — Consequences Engine

### 4.1. Data Flow

```
Player declares attack action (natural language)
          │
          ▼
   AI Narrator (intent detection)
          │ calls tool: resolveAttack({ attackerId, targetId, weaponId })
          ▼
  ┌────────────────────────────────────────────┐
  │           lib/rules/combat.ts              │
  │                                            │
  │  resolveAttackRoll() → hit/miss/crit       │
  │  rollDamage() → raw damage number          │
  │  applyDamage() → hp_after                  │
  │  rollHitLocation() → body part             │
  │  computeConsequences() ──────────────┐     │
  │                                      │     │
  └──────────────────────────────────────┼─────┘
                                         │
                       ┌─────────────────▼─────────────────┐
                       │     CombatConsequences (JSON)      │
                       │                                    │
                       │  combat_facts: {                   │
                       │    attacker, defender, weapon,      │
                       │    damage, damage_type, hp_before,  │
                       │    hp_after, is_crit, is_fumble,    │
                       │    hit_location, status_applied,    │
                       │    overkill                         │
                       │  }                                  │
                       │  narrative_tags: string[]           │
                       │  narrative_intensity: 0.0–1.0       │
                       │  combat_beat: string                │
                       │  style_dsl: { voice, visual, ...}   │
                       │  suggested_senses: string[]         │
                       │  suggested_actions: string[]        │
                       └───────────────┬───────────────────┘
                                       │
                                       ▼
                           AI Narrator system prompt
                           (via formatter.ts injection)
                                       │
                                       ▼
                             Streaming narration to UI
                                       │
                                       ▼
                         UI: badges, beat chips, grid update
```

### 4.2. Type Definitions (`lib/rules/combat.ts`)

```typescript
// ── New types for the Consequences Engine ──

export type DamageType =
  | "slashing" | "piercing" | "bludgeoning"
  | "fire" | "cold" | "lightning" | "acid" | "poison"
  | "necrotic" | "radiant" | "psychic" | "thunder" | "force";

export type HitLocation =
  | "head" | "neck" | "shoulder" | "chest" | "abdomen"
  | "arm" | "hand" | "leg" | "knee" | "foot";

export type CombatBeat =
  | "opening"         // encounter setup, atmosphere
  | "first_blood"     // first successful hit that deals damage
  | "turning_point"   // HP crosses 50% threshold, advantage shift
  | "climax"          // boss/leader drop, player near death
  | "aftermath";      // post-combat, silence, scars

export type GoreLevel = "PG13" | "Mature";

export interface CombatFacts {
  attacker: string;           // "PC:Kara" or "NPC:Orc Leader"
  defender: string;
  weapon: string;
  damage: number;
  damage_type: DamageType;
  hp_before: number;
  hp_after: number;
  is_crit: boolean;
  is_fumble: boolean;
  hit_location: HitLocation;
  status_applied: string[];   // e.g. ["bleeding", "prone"]
  overkill: number;           // max(0, damage - hp_before)
}

export interface CombatConsequences {
  combat_facts: CombatFacts;
  narrative_tags: string[];         // curated sensory tags
  narrative_intensity: number;      // 0.0–1.0
  combat_beat: CombatBeat;
  style_dsl: StyleDSL;
  suggested_senses: string[];      // 2 of [sight, sound, smell, touch, taste]
  suggested_actions: string[];     // tactical hooks: ["push", "disarm"]
}

export interface StyleDSL {
  voice: "active";
  visual: "low" | "medium" | "high";
  sentences: "short" | "medium" | "long";
  metaphors: "sparse" | "moderate" | "rich";
  senses: number;                  // target count 0–3
  verbs: "hard";
  adverbs: "low";
}

export interface TensionState {
  score: number;                   // 0.0–1.0
  avg_enemy_hp_ratio: number;
  player_hp_ratio: number;
  enemy_count: number;
  boss_alive: boolean;
}
```

### 4.3. Pure Functions to Implement

| Function | Input | Output | Pure? |
|----------|-------|--------|-------|
| `rollDamage(dice: string, isCrit: boolean)` | Dice notation + crit flag | `{ total: number, rolls: number[] }` | ✓ (random) |
| `rollHitLocation()` | — | `HitLocation` | ✓ (random) |
| `computeOverkill(damage, hpBefore)` | Numbers | `number` (≥0) | ✓ |
| `deriveNarrativeTags(facts: CombatFacts)` | CombatFacts | `string[]` | ✓ |
| `computeNarrativeIntensity(facts, tension)` | CombatFacts + TensionState | `number` [0..1] | ✓ |
| `deriveCombatBeat(encounter, facts)` | EncounterSnapshot + CombatFacts | `CombatBeat` | ✓ |
| `computeTension(combatants)` | Array of {hp, maxHp, isPlayer, isBoss} | `TensionState` | ✓ |
| `deriveStyleDSL(intensity, beat)` | Numbers + beat | `StyleDSL` | ✓ |
| `selectSenses(usedRecently: string[])` | Last 5 senses used | `string[]` (2 items) | ✓ (random) |
| `selectTacticalHooks(facts, zones)` | CombatFacts + Zone info | `string[]` | ✓ |
| `computeConsequences(...)` | Full attack context | `CombatConsequences` | ✓ |

### 4.4. Narrative Tag Catalogue

A static data file `data/narrative-tags.json` containing the curated ~200 sensory tags, organized by:

```json
{
  "slashing": {
    "crit": {
      "head": ["decapitation_arc", "scalp_flap", "skull_glimpse"],
      "shoulder": ["desgarro", "armor_screech", "sinew_snap"],
      ...
    },
    "hit": {
      "head": ["gash", "blood_veil", "stagger"],
      ...
    }
  },
  "bludgeoning": { ... },
  "piercing": { ... },
  ...
}
```

Lookup key: `(damage_type, is_crit ? "crit" : "hit", hit_location)`.

Each tag maps to a curated verb/image pair. The AI is instructed: **"You MUST use at least one `narrative_tag` from the `must_use_tags` array in your narration."**

### 4.5. Narrative Intensity Formula

```
base = 0.0
if is_crit:       base += 0.40
if hp_after <= 0: base += 0.20  (death)
if overkill > 0:  base += 0.05 * min(overkill, 4)
if status_applied.length > 0: base += 0.10
if hit_location ∈ {"head", "neck"}: base += 0.10
base -= 0.20 if (damage / maxHp < 0.1)  // trivial scratch

intensity = clamp(base + tension.score * 0.30, 0.0, 1.0)
```

### 4.6. Beat Detection Logic

```
function deriveCombatBeat(encounter, facts):
  if encounter.round === 1 AND no damage dealt yet:
    return "opening"
  if encounter.totalDamageDealt === facts.damage:
    return "first_blood"  (this is the first damage event)
  if facts.hp_after <= 0 AND defender.isBoss:
    return "climax"
  if any combatant crossed below 50% HP this turn:
    return "turning_point"
  if encounter.status === "resolved":
    return "aftermath"
  return current beat (carry forward)
```

### 4.7. Tension Score Formula

```
tension = w1 * (1 - avg_enemy_hp_ratio)
        + w2 * (1 - player_hp_ratio)
        + w3 * (enemy_count > 2 ? 0.1 * min(enemy_count, 6) : 0)
        + w4 * (boss_alive ? 0.15 : 0)

Weights: w1=0.3, w2=0.3, w3=0.2, w4=0.2
Clamp to [0, 1].
```

---

## 5. Architecture — Turn-Based Combat Loop

### 5.1. Loop Orchestrator

The turn-based loop is **tool-driven**, not a separate server loop. The AI narrator observes whose turn it is and calls the appropriate resolution tool.

```
Round N, Turn T:
  1. Formatter inserts: "It is [Combatant T]'s turn. Round [N]."
  2. If combatant is Player:
       AI prompts player for action.
       Player submits action (e.g., "I swing my axe at the orc").
       AI calls resolveAttack tool → gets CombatConsequences payload.
       AI narrates using the consequences.
  3. If combatant is Enemy:
       AI decides enemy action using SRD statblock.
       AI calls resolveAttack tool → gets CombatConsequences payload.
       AI narrates the enemy's action.
  4. State mutation: HP, conditions, zone position persisted.
  5. advanceTurn() → next combatant.
  6. resolveEncounterEnd() → check if combat should end.
  7. If ended → beat = "aftermath", final narration.
```

### 5.2. Integration with spatial.ts

- Before resolving a melee attack, validate range via `isWithinRange()`.
- If attacker and defender are not in the same or adjacent zone, the attack fails with a "out of range" fact.
- Movement during combat consumes the combatant's movement action and calls `canMove()` + `moveCombatant()`.
- Environment reactions (future Slice 4) create temporary hazard zones.

---

## 6. Architecture — AI Tooling & Prompt Updates

### 6.1. New Tool: `resolveAttack`

Added to `buildTools()` in `lib/ai/narrator.ts`:

```typescript
resolveAttack: tool({
  description:
    "Resolve a melee or ranged attack against a target. Returns the full " +
    "combat consequences payload including hit/miss, damage, hit location, " +
    "narrative tags, intensity, and current combat beat. " +
    "MUST be called before narrating any attack — never invent damage, " +
    "hit locations, or combat effects.",
  inputSchema: z.object({
    attackerId: z.string(),
    targetId: z.string(),
    weaponDamageDice: z.string().describe("e.g. '1d8+3'"),
    attackModifier: z.number(),
    damageType: z.enum([...DAMAGE_TYPES]),
  }),
  execute: async ({ attackerId, targetId, weaponDamageDice, attackModifier, damageType }) => {
    // 1. Fetch combatant state from DB
    // 2. Call resolveAttackRoll(attackModifier, targetAC)
    // 3. If hit: rollDamage(weaponDamageDice, isCrit)
    // 4. rollHitLocation()
    // 5. applyDamage() + persist
    // 6. computeConsequences() → return CombatConsequences JSON
  },
})
```

### 6.2. Prompt Updates in `formatter.ts`

#### New section: `formatCombatConsequences()`

Injected into the system prompt **only during active combat** when a consequences payload is available:

```markdown
## Combat Resolution — CURRENT ACTION
**Beat:** first_blood | **Intensity:** 0.85 | **Gore:** Mature

**Facts:**
- Attacker: PC:Kara | Defender: NPC:Orc Leader
- Weapon: War Axe (slashing) | Damage: 13 | Crit: YES
- Hit Location: shoulder | HP: 11 → -2 (DEAD) | Overkill: 4
- Status Applied: [bleeding]

**Must-Use Tags:** [desgarro, armor_screech, knee_collapse]
**Suggested Senses:** [sight, sound]
**Tactical Hooks:** [⚑ Slippery floor → push, ⚑ Wounded arm → disarm]

[STYLE]
VOICE=active | VISUAL=high | SENTENCES=short | METAPHORS=moderate
SENSES=2 | VERBS=hard | ADVERBS=low
[/STYLE]
```

#### Updated Iron Laws section

Add to `formatIronLaws()`:

```
**Visceral Narrative Laws:**
- Narrate consequences using ONLY the `combat_facts` provided. Never invent damage numbers, hit locations, or overkill values.
- You MUST incorporate at least one tag from `must_use_tags` in your narration.
- Respect `narrative_intensity`: 0.9 = crude, sensory, 2–3 senses, hard verbs; 0.3 = synthetic, brief.
- Respect `combat_beat`: opening = atmosphere; first_blood = shock; turning_point = momentum; climax = finality; aftermath = silence + echo.
- Respect `gore_level`: PG13 uses metaphor over gore; Mature uses visceral detail.
- Respect `[STYLE]` block: voice, visual density, sentence length, metaphor frequency.
- Never use: "very", "strongly", "quickly", "suddenly". Prefer precise verb + sensory image.
- Beats: apertura → primera sangre → giro → clímax → epílogo. Never skip ahead.
```

---

## 7. Architecture — VTT Visual Integration

### 7.1. Grid Renderer Component

`components/combat/BattleGrid.tsx`:

- Renders the `Zone[]` from the active encounter as a grid of cells.
- Each cell shows zone name, terrain type (if any).
- Combatant tokens are positioned in their assigned zone.
- The current-turn combatant is highlighted.
- Movement legality is indicated by highlighting adjacent zones.

### 7.2. Consequence Badge System

`components/combat/ConsequenceBadge.tsx`:

- Inline badges in the combat log for each consequence type:
  - `SANGRADO` (red pulse)
  - `ROTURA` (bone icon)
  - `MIEDO` (purple tremor)
  - `HAZARD` (orange warning)
  - `CRIT` (gold flash)
  - `FUMBLE` (grey crack)
  - `DEATH` (skull)
- Hover on any badge shows the full mechanical breakdown + generated narrative snippet.

### 7.3. Beat Marker Chips

`components/combat/BeatMarker.tsx`:

- A horizontal chip bar at the top of the combat panel:
  - `APERTURA` → `PRIMERA SANGRE` → `GIRO` → `CLÍMAX` → `EPÍLOGO`
- The current beat is highlighted; past beats are dimmed.
- Each chip can be hovered for a tooltip explaining the beat's narrative directive.

### 7.4. Enhanced InitiativeTracker

Update `components/combat/InitiativeTracker.tsx`:

- Show HP bars with color-coded health (green → yellow → red).
- Show active conditions as small status icons.
- Show hit-location indicator on the most recent attack.
- Animate the current-turn marker.

---

## 8. Database Schema Changes

```prisma
model Combatant {
  // ... existing fields ...

  /// Last attack's hit location for narration continuity. Null if never hit.
  lastHitLocation  String?
  /// Persistent wounds that carry mechanical penalties. JSON array of wound descriptors.
  wounds           Json    @default("[]")
}

model Encounter {
  // ... existing fields ...

  /// Current cinematic beat for this encounter.
  combatBeat       String  @default("opening")
  /// Accumulated total damage dealt across all combatants (for beat detection).
  totalDamageDealt Int     @default(0)
  /// Current tension score [0..100] stored as integer for DB simplicity.
  tensionScore     Int     @default(0)
}
```

---

## 9. Slice Breakdown

### Slice 1 — Pure Rules: Combat Consequences Engine
**Priority:** P0 — Must be first. All other slices depend on this.

| Task | File | Type | Depends On |
|------|------|------|------------|
| 1.1 Define all new types (CombatFacts, CombatConsequences, etc.) | `lib/rules/combat.ts` | Types | — |
| 1.2 Implement `rollDamage(dice, isCrit)` | `lib/rules/combat.ts` | Pure fn | `dice.ts` |
| 1.3 Implement `rollHitLocation()` | `lib/rules/combat.ts` | Pure fn | — |
| 1.4 Implement `computeOverkill(damage, hpBefore)` | `lib/rules/combat.ts` | Pure fn | — |
| 1.5 Create narrative tag catalogue | `data/narrative-tags.json` | Data | — |
| 1.6 Implement `deriveNarrativeTags(facts)` | `lib/rules/combat.ts` | Pure fn | 1.5 |
| 1.7 Implement `computeTension(combatants)` | `lib/rules/combat.ts` | Pure fn | — |
| 1.8 Implement `computeNarrativeIntensity(facts, tension)` | `lib/rules/combat.ts` | Pure fn | 1.7 |
| 1.9 Implement `deriveCombatBeat(encounter, facts)` | `lib/rules/combat.ts` | Pure fn | — |
| 1.10 Implement `deriveStyleDSL(intensity, beat)` | `lib/rules/combat.ts` | Pure fn | — |
| 1.11 Implement `selectSenses(usedRecently)` | `lib/rules/combat.ts` | Pure fn | — |
| 1.12 Implement `selectTacticalHooks(facts, zones)` | `lib/rules/combat.ts` | Pure fn | — |
| 1.13 Implement `computeConsequences(...)` orchestrator | `lib/rules/combat.ts` | Pure fn | 1.1–1.12 |
| 1.14 Write unit tests for all pure functions | `tests/rules/combat.test.ts` | Tests | 1.1–1.13 |

**Acceptance Criteria:**
- All functions are pure (no I/O, no DB, no side effects).
- `computeConsequences()` returns a valid `CombatConsequences` object for any input combination.
- 100% of edge cases tested: crit + death + overkill, fumble, trivial scratch, all damage types × all locations.
- `pnpm test` passes.

---

### Slice 2 — AI Tooling & Visceral Narrative Prompt
**Priority:** P0 — Needed for narrative integration.

| Task | File | Type | Depends On |
|------|------|------|------------|
| 2.1 Add `resolveAttack` tool to `buildTools()` | `lib/ai/narrator.ts` | Tool | Slice 1 |
| 2.2 Implement tool execute function (DB fetch → resolve → persist → return consequences) | `lib/ai/narrator.ts` | Async | Slice 1, schema |
| 2.3 Schema migration: add `lastHitLocation`, `wounds` to Combatant; `combatBeat`, `totalDamageDealt`, `tensionScore` to Encounter | `prisma/schema.prisma` | Migration | — |
| 2.4 Add `formatCombatConsequences()` section builder | `lib/memory/formatter.ts` | Pure fn | Slice 1 types |
| 2.5 Update `formatIronLaws()` with Visceral Narrative Laws | `lib/memory/formatter.ts` | Pure fn | — |
| 2.6 Add `[STYLE]` block injection per beat/intensity | `lib/memory/formatter.ts` | Pure fn | Slice 1 |
| 2.7 Wire `formatCombatConsequences()` into `formatSystemPrompt()` | `lib/memory/formatter.ts` | Pure fn | 2.4 |
| 2.8 Add `gore_level` to campaign settings (default: "Mature") | `prisma/schema.prisma` + context | Migration | — |
| 2.9 Integration test: full attack cycle via narrator → verify CombatConsequences in streamed context | `tests/integration/` | Test | 2.1–2.7 |

**Acceptance Criteria:**
- The AI narrator tool `resolveAttack` returns a valid `CombatConsequences` JSON.
- The system prompt contains all combat consequence sections during active combat.
- The Iron Laws explicitly forbid the AI from inventing any combat mechanical data.
- Type-check: `pnpm tsc --noEmit` passes.
- Integration test confirms the facts → tags → intensity → beat → style pipeline end-to-end.

---

### Slice 3 — VTT Visual Integration
**Priority:** P1 — Enhances combat experience after mechanics are solid.

| Task | File | Type | Depends On |
|------|------|------|------------|
| 3.1 Create `BattleGrid.tsx` — zone-based grid renderer | `components/combat/BattleGrid.tsx` | React | spatial.ts, schema |
| 3.2 Create `ConsequenceBadge.tsx` — inline consequence badges | `components/combat/ConsequenceBadge.tsx` | React | Slice 1 types |
| 3.3 Create `BeatMarker.tsx` — cinematic beat progress bar | `components/combat/BeatMarker.tsx` | React | Slice 1 types |
| 3.4 Update `InitiativeTracker.tsx` — HP bars, conditions, hit-location indicator | `components/combat/InitiativeTracker.tsx` | React | Slice 1 types |
| 3.5 Update `GameEventHandler.tsx` — consume CombatConsequences from tool response, dispatch badges & beat updates | `components/combat/GameEventHandler.tsx` | React | Slice 2 |
| 3.6 Add combat CSS — dark fantasy palette, badge animations, beat chip styling | `app/globals.css` or module CSS | CSS | — |
| 3.7 Accessibility pass — keyboard navigation for grid, ARIA labels for badges, reduced-motion compat | All combat components | A11Y | 3.1–3.5 |
| 3.8 Manual UI smoke test — play a full combat encounter through the UI | — | Manual | 3.1–3.7 |

**Acceptance Criteria:**
- `BattleGrid` renders all zones from an active encounter with combatant tokens.
- Consequence badges appear inline in the combat log for hits, crits, deaths, and status effects.
- Beat markers progress from `APERTURA` to `EPÍLOGO` correctly during a full encounter.
- All new components meet PROJECT_CONTEXT.md §12 accessibility minimums.
- `pnpm build` succeeds without errors.

---

## 10. Future Slices (Not in Milestone J Scope)

| Slice | Feature | Blocked By |
|-------|---------|------------|
| 4 | Environment Reactions & Hazard Zones | Slice 3 (grid needed) |
| 4 | Aftermath + Persistent Scars | Slice 2 (wound system) |
| 4 | Finisher / Mercy Prompts | Slice 2 (beat = climax trigger) |
| 5 | Narrative QA Metrics | All slices (needs production data) |
| 5 | Crit/Fumble Template Library (60–100 curated snippets) | Slice 1 (tag catalogue) |

---

## 11. Verification Plan

### Automated Tests

| Layer | What | Command |
|-------|------|---------|
| Unit | All pure functions in Slice 1 | `pnpm vitest run tests/rules/combat.test.ts` |
| Type | Full project type-check | `pnpm tsc --noEmit` |
| Integration | resolveAttack tool cycle | `pnpm vitest run tests/integration/` |
| Build | Production build | `pnpm build` |

### Manual Verification

| Check | Method |
|-------|--------|
| Consequences pipeline correctness | Spawn encounter → attack → verify JSON payload in console |
| Narrative quality | Read 3 AI narrations at intensity 0.3, 0.6, 0.9 — check tag usage, verb quality, beat respect |
| VTT rendering | Visual inspection of grid, badges, beat markers during a 4-round fight |
| Accessibility | Keyboard-only navigation through combat UI; screen reader check on badges |

---

## 12. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Narrative tag catalogue too sparse → repetitive narration | Medium | Medium | Start with ~80 high-quality tags covering all damage types; expand iteratively |
| AI ignoring `must_use_tags` constraint | Medium | High | Enforce via strong Iron Law in prompt; add post-hoc validation in Slice 5 |
| Turn-based loop complexity causing state corruption | Low | Critical | All state mutations go through Prisma transactions; `resolveEncounterEnd` checked after every turn |
| Performance: CombatConsequences computation adds latency | Low | Low | All functions are pure/synchronous; no DB calls in computation step |
| Beat detection edge cases (simultaneous deaths, tied initiative) | Medium | Low | Handle via priority rules documented in §4.6; test each edge case explicitly |

---

## 13. Glossary

| Term | Definition |
|------|-----------|
| **CombatConsequences** | The structured JSON payload produced by the Consequences Engine for every attack action |
| **Narrative Tags** | Curated sensory descriptors (e.g., "desgarro", "armor_screech") the AI must use |
| **Narrative Intensity** | A [0..1] gradient controlling prose viscerality |
| **Combat Beat** | The current act in the encounter's dramatic arc |
| **Style DSL** | A compact configuration block controlling AI narrative style per-event |
| **Tension Score** | A [0..1] value reflecting the danger level of the current combat |
| **Overkill** | Excess damage beyond the target's remaining HP |
| **Hit Location** | The anatomical target of an attack, resolved by table |
| **VTT** | Virtual Table Top — the visual combat grid |
