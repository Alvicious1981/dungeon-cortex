# Milestone N — Architecture Closure Report
## NPC Social Interaction & Disposition System

**Completed:** 2026-04-15
**Branch:** `master` — commit `2edbbe6`
**Tests:** 161 passing (98 rules, 18 formatter, 25 component, pre-existing loot failure excluded)
**TypeScript:** 0 errors (`pnpm exec tsc --noEmit`)

---

## 1. Disposition Scale & Band Mapping

The disposition integer is the canonical social state. Range: **−10 (Actively Hostile) → +10 (Actively Helpful)**.

### Band Boundaries (`getDispositionBand`)

| Band        | Integer range  | Icon | Initial value set by rollReaction |
|-------------|---------------|------|-----------------------------------|
| Hostile     | ≤ −7          | 🔴   | −8                                |
| Unfriendly  | −6 to −2      | 🟠   | −4                                |
| Indifferent | −1 to +2      | ⚪   | 0                                 |
| Friendly    | +3 to +7      | 🟢   | +4                                |
| Helpful     | ≥ +8          | 💛   | +8                                |

### 2d6 Reaction Roll Table (OSR/AD&D 1e)

| Modified 2d6 total | Band assigned |
|--------------------|--------------|
| 2–3                | Hostile      |
| 4–5                | Unfriendly   |
| 6–8                | Indifferent  |
| 9–11               | Friendly     |
| 12–14 (capped)     | Helpful      |

**CHA modifier** is applied before table lookup; modified total is clamped to `[2, 14]`.

---

## 2. Tool Schemas

All three tools are registered in `buildTools()` inside `lib/ai/narrator.ts`. Input schemas live in `lib/rules/social.ts` and are validated by Zod before any DB write.

### `rollReaction`

```typescript
// Input
{
  npcSeed:          string   // 1–100 chars — stable NPC identifier
  npcRole:          "guard" | "bandit" | "commoner"
  charismaModifier: number   // int, clamped [-5, +5]
}

// Output (ReactionRollResult)
{
  dice:             [1..6, 1..6]    // raw die values
  rawTotal:         number           // sum of dice
  modifiedTotal:    number           // clamped to [2, 14]
  charismaModifier: number
  dispositionBand:  DispositionBand
  initialDisposition: number        // written to NPC.disposition
  personality: {
    motivation:       string
    secret:           string
    distinctiveTrait: string
  }
}
```

**Side effects:** `prisma.nPC.upsert` on `(campaignId, seed)`. Creates NPC record on first meeting; updates `disposition`, `personalityTags`, `hasMetPlayer = true` on repeat.

**Guard:** Only call when `NPC.hasMetPlayer === false`.

---

### `socialCheck`

```typescript
// Input
{
  npcSeed:          string            // 1–100 chars
  characterId:      string
  approach:         "persuade" | "intimidate" | "deceive"
  dispositionDelta: number            // int 1–4 — shift magnitude attempted
  intent:           string            // ≤ 200 chars — narrative framing only
}

// Output (SocialCheckResult)
{
  approach:              ApproachEnum
  roll:                  number       // d20 natural result
  charismaModifier:      number
  total:                 number       // roll + modifier
  dc:                    number
  success:               boolean
  isCriticalSuccess:     boolean      // nat 20
  isCriticalFailure:     boolean      // nat 1
  dispositionBefore:     number
  dispositionAfter:      number       // clamped [-10, +10]
  dispositionBandBefore: DispositionBand
  dispositionBandAfter:  DispositionBand
  backfire:              boolean      // true if Intimidate failed
}
```

**DC formula:** `10 + max(0, −disposition) + (delta − 1) × 3 + (intimidate ? −2 : 0)`

**Disposition shift rules:**

| Outcome | Persuade / Deceive | Intimidate |
|---------|-------------------|------------|
| Critical Success (nat 20) | `+delta + 1` | `+delta + 1` |
| Success | `+delta` | `+delta` |
| Critical Failure (nat 1) | `0` | `−2` (backfire) |
| Failure | `0` | `−1` (backfire) |

**Side effects:** `prisma.nPC.update` — writes `dispositionAfter` to `NPC.disposition`.

**Guard:** Requires `NPC.hasMetPlayer === true`; rejects with error message if not.

---

### `getRumors`

```typescript
// Input
{
  npcSeed:    string   // 1–100 chars
  campaignId: string
}

// Output (RumorPayload)
{
  npcName:        string
  disposition:    number
  dispositionBand: DispositionBand
  rumors: Array<{
    nodeId:   string
    nodeName: string
    feature:  string    // "npc" | "hazard" | "treasure" | "quest_hook" | "rest" | "shop" | "exit"
    rumor:    string    // ≤ 300 chars, derived from LocationNode.description
  }>
  refusalReason?: string  // present only when disposition < 3
}
```

**Disposition gate:** `disposition < 3` → empty rumors + `refusalReason`. No DB writes.

**Rumor derivation:** Sourced exclusively from `LocationNode.description` (truncated to 120 chars) — the AI cannot inject facts not in the database.

---

## 3. Deterministic NPC Personality

`generateNPCPersonality(seed: string)` picks one entry from each of three 22-item tables using `pickSeeded(seed + ":tag", TABLE)` (cyrb53 PRNG). Same seed always produces the same personality — stable across sessions and re-renders.

**Tables:** `MOTIVATIONS`, `SECRETS`, `DISTINCTIVE_TRAITS` — 22 entries each → 10,648 unique combinations.

**Secret withholding:** The NPC's `secret` is stored in `NPC.personalityTags` but is intentionally excluded from the `formatNPCContext()` prompt block. The narrator cannot reveal it until the player reaches Helpful disposition and asks the right question.

---

## 4. UI State Mapping — `DispositionBadge`

**File:** `components/npc/DispositionBadge.tsx`
**Contract:** Read-only. Receives persisted `disposition: number | null` from the caller; maps to visual representation. Never mutates state or calls the AI.

| State | Rendered output | `data-band` | `data-disposition` |
|-------|----------------|-------------|-------------------|
| `null` (unmet) | `⬜ Unknown` | `"unknown"` | absent |
| ≤ −7 | `🔴 Hostile (n)` | `"Hostile"` | `n` |
| −6 to −2 | `🟠 Unfriendly (n)` | `"Unfriendly"` | `n` |
| −1 to +2 | `⚪ Indifferent (n)` | `"Indifferent"` | `n` |
| +3 to +7 | `🟢 Friendly (n)` | `"Friendly"` | `n` |
| ≥ +8 | `💛 Helpful (n)` | `"Helpful"` | `n` |

**Props:** `disposition`, `className`, `compact` (omits numeric value when true).
**Accessibility:** `aria-label="Disposition: {Band} ({n})"` on every numeric case; `"Disposition: unknown — rollReaction not yet called"` for null.

---

## 5. Prompt Layer — Iron Laws Addition

`formatIronLaws()` in `lib/memory/formatter.ts` now includes the **Social Interaction Mandate**:

> When you first speak with any NPC in a scene (NPC.hasMetPlayer === false), you MUST call `rollReaction`. When the player attempts to persuade, intimidate, or deceive, you MUST call `socialCheck` before narrating the outcome. When the player asks for local information, you MUST call `getRumors`. **The engine decides what the NPC knows and feels. You voice it. Code is Law.**

`formatNPCContext(npc: ActiveNPC)` injects a `## 🎭 NPC:` block when `activeNPC` is present in context:
- **Unmet:** single line instructing narrator to call `rollReaction`.
- **Met:** Disposition band + icon + numeric value, Motivation, Distinctive Trait. Secret is withheld.

---

## 6. Database Schema Additions

Three fields added to the `NPC` model in `prisma/schema.prisma`:

```prisma
disposition     Int?     // null = unmet; set by rollReaction; updated by socialCheck
personalityTags Json?    // { motivation, secret, distinctiveTrait }; null until first meeting
hasMetPlayer    Boolean  @default(false)
```

Applied via `npx prisma db push` (migration drift with Supabase extensions; no new migration file generated).

---

## 7. Known Pre-existing Issue (Out of Scope)

`tests/rules/loot.test.ts` — 1 test failing (`rollMagicItems > all items pass LootItemSchema validation`). Confirmed present on `master` before any Milestone N changes. Not introduced by this milestone.

---

## 8. Files Modified / Created

| File | Change |
|------|--------|
| `prisma/schema.prisma` | +3 fields on `NPC` model |
| `lib/rules/social.ts` | Created — 531 lines, pure engine |
| `lib/ai/narrator.ts` | +165 lines — 3 tools wired to Prisma |
| `lib/memory/formatter.ts` | +73 lines — mandate + `formatNPCContext` |
| `components/npc/DispositionBadge.tsx` | Created — presentational component |
| `tests/rules/social.test.ts` | Created — 98 tests |
| `tests/memory/formatter.test.ts` | +156 lines — 18 new test cases |
| `tests/components/DispositionBadge.test.tsx` | Created — 25 tests |
| `docs/MILESTONE_N_SPEC.md` | Created — canonical spec |

**Milestone N is closed. Standby for next specification.**
