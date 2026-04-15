# Milestone N — "The Senate" — Social Interaction & NPC Disposition System

> **Precedence:** This document is subordinate to `PROJECT_CONTEXT.md` §25 (Precedence Order) and explicit user instructions.
> **Status:** Approved for execution — slice by slice.
> **Prerequisite:** Milestone M (The Market — NPC Trade & Dynamic Economy) — confirmed 100% closed and committed to git.

---

## 1. Objective

Implement a **Social Interaction & NPC Disposition System** that activates whenever the player initiates a non-combat conversation with an NPC. The system:

1. **Reaction Engine:** When the party first addresses an NPC, the AI Narrator **must** call a new `rollReaction` tool. This performs a 2d6 roll, modified by the party leader's Charisma modifier, to determine the NPC's *initial disposition* — the OSR/AD&D 1e Reaction Roll table is the canonical authority. The roll is mechanical; the AI **cannot** decide if an NPC is friendly or hostile on its own.
2. **Disposition Tracking:** Each NPC record in the database holds a persistent `disposition` integer in `[-10, +10]`. The scale maps: −10 = Actively Hostile, 0 = Neutral, +10 = Actively Helpful. Disposition drifts up or down via the `socialCheck` tool (successful persuasion, intimidation, or deception mechanics). It persists in the `NPC` table across sessions — a shopkeeper the party charmed on Day 1 is still friendly on Day 7.
3. **NPC Personality:** Every NPC grows three **Personality Tags** — a `motivation`, a `secret`, and a `distinctiveTrait` — derived deterministically from their seed. These tags are injected into the system prompt context so the Narrator can voice the NPC consistently without inventing characteristics.
4. **Rumor Engine:** A `getRumors` tool allows NPCs who are Friendly or better (disposition ≥ 3) to share relevant, *non-hallucinated* information about adjacent `LocationNode`s — their feature types, known hazards, or quest hooks — drawn entirely from persisted database state. The AI **cannot** invent rumors; it calls the tool and narrates what the tool returns.

### Design Pillars (inherited from `PROJECT_CONTEXT.md`)

| Pillar | Application in Milestone N |
|---|---|
| **Code is Law** | The AI Narrator **cannot** decide unilaterally whether an NPC is persuaded, frightened, or deceived. Every shift in disposition must be the result of a `rollReaction` or `socialCheck` tool call whose outcome is computed by the engine. The narrative follows the numbers; the numbers do not follow the narrative. |
| **Diegetic immersion** | NPCs are individuals, not props. Their personality tags — motivation, secret, distinctive trait — are character facts derived from their seed. The Narrator gives voice to these facts; it does not invent them. |
| **State is Truth** | `NPC.disposition` persists in Prisma. A single `socialCheck` call that shifts disposition from 2 → 4 is a database write. Future narrative turns read that value from the DB context. There is no separate "session memory" of disposition. |
| **100% Test Coverage** | Every pure function must have comprehensive unit tests. Every Zod schema must have passing validation tests. No slice is complete until `pnpm test` passes with full coverage of all new code. |

---

## 2. Core Loop — Approach → React → Converse → Persist

```
  Player initiates conversation with NPC at a LocationNode
          │
          ▼
  AI Narrator MUST call: rollReaction({ npcSeed, charismaModifier })
          │
          ▼
  ┌──────────────────────────────────────────────────────────────────────┐
  │                lib/rules/social.ts (pure)                           │
  │                                                                      │
  │  1. Roll 2d6 (two independent d6 dice)                              │
  │  2. Apply charismaModifier (flat addition, clamped: ±5 max)         │
  │  3. Map raw total → DispositionBand:                                │
  │       2–3   → Hostile         (initial disposition = −8)            │
  │       4–5   → Unfriendly      (initial disposition = −4)            │
  │       6–8   → Indifferent     (initial disposition =  0)            │
  │       9–11  → Friendly        (initial disposition = +4)            │
  │       12+   → Helpful         (initial disposition = +8)            │
  │  4. Return ReactionRollResult                                        │
  └───────────────────────────────┬──────────────────────────────────────┘
                                  │
                                  ▼
  Tool persists initial disposition to NPC.disposition (Prisma upsert)
                                  │
                                  ▼
  AI Narrator voices NPC opening using:
    • NPCPersonality.motivation, .secret, .distinctiveTrait (injected context)
    • DispositionBand for tone (Hostile = terse/threatening; Helpful = warm)
                                  │
                                  ▼
  Player chooses social intent → AI calls socialCheck({
    npcSeed, approach: "persuade" | "intimidate" | "deceive",
    characterId, dispositionDelta
  })
                                  │
                                  ▼
  ┌──────────────────────────────────────────────────────────────────────┐
  │                socialCheck tool (validated)                         │
  │                                                                      │
  │  1. Fetch Character.stats from DB → derive CHA modifier             │
  │  2. Roll 1d20 + CHA modifier vs DC (derived from current disposi-  │
  │     tion — harder to sway an already-hostile NPC)                   │
  │  3. On SUCCESS: NPC.disposition += dispositionDelta (clamped ±10)   │
  │  4. On FAILURE: NPC.disposition stays (or drops 1 if intimidation  │
  │     fails — backfire mechanic)                                       │
  │  5. Persist updated disposition via Prisma transaction              │
  │  6. Return SocialCheckResult                                         │
  └───────────────────────────────┬──────────────────────────────────────┘
                                  │
                                  ▼
  AI Narrator narrates outcome using ONLY the returned facts
                                  │
                       ┌──────────┴──────────┐
                       │                      │
            disposition ≥ 3?              disposition < 3?
                (Friendly+)                (Neutral or worse)
                       │                      │
                       ▼                      ▼
          getRumors({ npcSeed })       NPC refuses to share
                       │               information; narrate
                       ▼               hostility or stonewalling
  ┌────────────────────────────────┐
  │  lib/rules/social.ts (pure)   │
  │                                │
  │  1. Fetch LocationNodes near   │
  │     the NPC's current node    │
  │  2. Filter for nodes with a   │
  │     non-"empty" feature       │
  │  3. Build RumorItem[] from    │
  │     DB-persisted node data    │
  │     (NO invented details)     │
  │  4. Return RumorPayload       │
  └────────────────────────────────┘
                       │
                       ▼
  AI Narrator delivers rumors using ONLY returned node facts
```

---

## 3. Existing Infrastructure Audit

### What exists (Milestone M baseline)

| Module | State | Relevance to Milestone N |
|--------|-------|--------------------------|
| `prisma/schema.prisma` — `NPC` | Has: `seed`, `role`, `name`, `hp`, `ac`, `notes`, `race`, `profession`, `alignment`, `abilityScores`, `traits` | **Extend** — add `disposition Int`, `personalityTags Json`, `hasMetPlayer Boolean` |
| `prisma/schema.prisma` — `Campaign` | Has `character`, `currentLocationId`, `currentNodeId` | **Read** — used by `getRumors` to scope nearby nodes |
| `prisma/schema.prisma` — `LocationNode` | Has `feature`, `npcSeed`, `description`, `featureData` | **Read** — `getRumors` pulls from persisted node data |
| `lib/rules/npc.ts` — `generateNPC()` | Deterministic statblock generator with `AbilityScores` and `NPCTraits` | **Extend** — add `generateNPCPersonality(seed)` alongside it |
| `lib/rules/dice.ts` — `roll()`, `d20Check()`, `abilityModifier()` | Full dice engine | **Reuse** — `rollReaction` uses `rollMany(2,6)`, `socialCheck` uses `d20Check()` |
| `lib/rules/generators.ts` — `seededFloat()`, `pickSeeded()` | Deterministic PRNG | **Reuse** — personality tag generation uses this PRNG |
| `lib/ai/narrator.ts` — `buildTools()` | Tool registry | **Integration** — `rollReaction`, `socialCheck`, `getRumors` go here |
| `lib/memory/formatter.ts` | Iron Laws, context sections | **Update** — add Social Interaction Mandate |
| `components/trade/TradeWindow.tsx` | Overlay component pattern | **Reference pattern** — `DialogueOverlay.tsx` follows the same architecture |
| `components/combat/IronGrimoire.tsx` | Dark-fantasy disposition visual reference | **Aesthetic reference** — disposition icon adopts the same icon style |

### What is missing

1. **`NPC.disposition`** column — no persistent disposition integer on the `NPC` model.
2. **`NPC.personalityTags`** column — no JSON column for motivation/secret/distinctiveTrait.
3. **`NPC.hasMetPlayer`** column — no flag tracking whether the party has met this NPC before (needed to suppress reaction re-rolls on repeat encounters).
4. **`lib/rules/social.ts`** — does not exist. The entire social mechanic module must be created.
5. **`generateNPCPersonality(seed)`** — no function to generate personality tags from a seed.
6. **`rollReaction` AI tool** — the Narrator has no tool to perform a 2d6 Reaction Roll.
7. **`socialCheck` AI tool** — the Narrator has no tool to resolve Persuade/Intimidate/Deceive checks.
8. **`getRumors` AI tool** — the Narrator has no tool to provide NPC-sourced location intelligence.
9. **Social Interaction Mandate in Iron Laws** — the AI is not yet constrained to use social tools for NPC interactions.
10. **`DialogueOverlay.tsx`** — no VTT component for the dialogue interface.
11. **Disposition visual** — no UI element representing the NPC's current disposition.

---

## 4. Slice 1 — Data Layer

**Priority:** P0 — Must be first. All other slices depend on this.
**Philosophy:** Schema first, types second, validation third. No business logic in this slice.

### 4.1. Prisma Schema Changes

Extend the `NPC` model in `prisma/schema.prisma` with three new fields:

```prisma
model NPC {
  // ... existing fields unchanged ...

  /// Current disposition toward the party. Range: −10 (Hostile) to +10 (Helpful).
  /// Set by rollReaction on first meeting; updated by socialCheck on social actions.
  /// Null for NPCs the party has never spoken to (reaction roll pending).
  disposition   Int?     @default(null)

  /// Personality Tags generated deterministically from the seed.
  /// JSON object: { motivation: string, secret: string, distinctiveTrait: string }
  /// Populated by generateNPCPersonality(seed) on first interaction.
  /// Never null after first meeting; null for legacy/unmet NPCs.
  personalityTags Json?

  /// True once the party has formally met this NPC (rollReaction has fired).
  /// Prevents duplicate reaction rolls on subsequent encounters.
  hasMetPlayer  Boolean  @default(false)
}
```

**Migration strategy:** Additive only. All three columns are nullable or have defaults — no existing row is broken. The migration name: `add_npc_social_fields`.

### 4.2. Personality Tags Type

Define in `lib/rules/social.ts`:

```typescript
/** The three Personality Tags that define an NPC's social identity. */
export interface NPCPersonality {
  /**
   * The NPC's primary driving desire — what they want above all else.
   * Example: "To retire and live peacefully on a farm far from the city."
   */
  motivation: string;
  /**
   * A hidden truth they guard carefully. Revealed only at high disposition.
   * Example: "They were once a spy for the Western Compact."
   */
  secret: string;
  /**
   * A memorable physical or behavioral habit that makes them distinct.
   * Example: "Taps the left side of their nose twice before speaking."
   */
  distinctiveTrait: string;
}
```

### 4.3. Disposition Enum Map

Define the five-band Reaction table in `lib/rules/social.ts`, following the OSR/AD&D 1e tradition:

```typescript
export const DISPOSITION_BANDS = {
  Hostile:      { min: 2,  max: 3,  initial: -8 },
  Unfriendly:   { min: 4,  max: 5,  initial: -4 },
  Indifferent:  { min: 6,  max: 8,  initial:  0 },
  Friendly:     { min: 9,  max: 11, initial:  4 },
  Helpful:      { min: 12, max: Infinity, initial: 8 },
} as const;

export type DispositionBand = keyof typeof DISPOSITION_BANDS;

/** Human-readable disposition band derived from a numeric disposition value. */
export function getDispositionBand(disposition: number): DispositionBand {
  if (disposition <= -7) return "Hostile";
  if (disposition <= -2) return "Unfriendly";
  if (disposition <=  2) return "Indifferent";
  if (disposition <=  7) return "Friendly";
  return "Helpful";
}
```

### 4.4. Zod Schemas for Tool I/O

#### `ReactionRollInput` schema:

```typescript
export const ReactionRollInputSchema = z.object({
  npcSeed: z
    .string()
    .min(1)
    .max(100)
    .describe(
      "The NPC's stable seed identifier. Must match the NPC's seed in the database. " +
      "This drives personality tag generation and disposition persistence."
    ),
  npcRole: z
    .enum(["guard", "bandit", "commoner"])
    .describe("The NPC's role — used to ensure the NPC record exists before rolling."),
  charismaModifier: z
    .number()
    .int()
    .min(-5)
    .max(5)
    .describe(
      "The party leader's Charisma ability modifier (NOT the score itself). " +
      "Derived from the Character's CHA stat: floor((CHA - 10) / 2). " +
      "Clamped to [-5, +5] — extremely high or low CHA has diminishing returns."
    ),
}).strict();

export type ReactionRollInput = z.infer<typeof ReactionRollInputSchema>;
```

#### `ReactionRollResult` schema:

```typescript
export const ReactionRollResultSchema = z.object({
  dice: z.tuple([z.number().int().min(1).max(6), z.number().int().min(1).max(6)]),
  rawTotal: z.number().int(),
  modifiedTotal: z.number().int(),
  charismaModifier: z.number().int(),
  dispositionBand: z.enum(["Hostile", "Unfriendly", "Indifferent", "Friendly", "Helpful"]),
  initialDisposition: z.number().int().min(-10).max(10),
  personality: z.object({
    motivation: z.string(),
    secret: z.string(),
    distinctiveTrait: z.string(),
  }),
});

export type ReactionRollResult = z.infer<typeof ReactionRollResultSchema>;
```

#### `SocialCheckInput` schema:

```typescript
export const SocialCheckInputSchema = z.object({
  npcSeed: z
    .string()
    .min(1)
    .max(100)
    .describe("The NPC's stable seed identifier."),
  characterId: z
    .string()
    .min(1)
    .describe("The character performing the social action — drives CHA mod derivation."),
  approach: z
    .enum(["persuade", "intimidate", "deceive"])
    .describe(
      "The social technique the player is using. " +
      "Persuade: appeals to reason or goodwill. " +
      "Intimidate: appeals to fear — risks backfire. " +
      "Deceive: uses misdirection — DC scales with NPC's INT modifier."
    ),
  dispositionDelta: z
    .number()
    .int()
    .min(1)
    .max(4)
    .describe(
      "How many disposition points the player is attempting to shift. " +
      "Higher deltas are harder to achieve (DC increases proportionally). " +
      "Typical values: 1 (small shift), 2 (notable shift), 3 (major shift), 4 (exceptional)."
    ),
  intent: z
    .string()
    .max(200)
    .describe(
      "A brief description of what the player said or did, in their own words. " +
      "Used by the Narrator to frame the outcome narratively. Not used in the math."
    ),
}).strict();

export type SocialCheckInput = z.infer<typeof SocialCheckInputSchema>;
```

#### `SocialCheckResult` schema:

```typescript
export const SocialCheckResultSchema = z.object({
  approach: z.enum(["persuade", "intimidate", "deceive"]),
  roll: z.number().int(),
  charismaModifier: z.number().int(),
  total: z.number().int(),
  dc: z.number().int(),
  success: z.boolean(),
  isCriticalSuccess: z.boolean(),
  isCriticalFailure: z.boolean(),
  dispositionBefore: z.number().int().min(-10).max(10),
  dispositionAfter: z.number().int().min(-10).max(10),
  dispositionBandBefore: z.enum(["Hostile", "Unfriendly", "Indifferent", "Friendly", "Helpful"]),
  dispositionBandAfter: z.enum(["Hostile", "Unfriendly", "Indifferent", "Friendly", "Helpful"]),
  backfire: z.boolean().describe("True if Intimidate failed and caused disposition to drop."),
});

export type SocialCheckResult = z.infer<typeof SocialCheckResultSchema>;
```

#### `GetRumorsInput` schema:

```typescript
export const GetRumorsInputSchema = z.object({
  npcSeed: z
    .string()
    .min(1)
    .max(100)
    .describe("The NPC seed — used to verify disposition before sharing information."),
  campaignId: z
    .string()
    .min(1)
    .describe("The campaign ID — used to scope the location graph query."),
}).strict();

export type GetRumorsInput = z.infer<typeof GetRumorsInputSchema>;
```

#### `RumorPayload` schema:

```typescript
export const RumorItemSchema = z.object({
  nodeId: z.string(),
  nodeName: z.string(),
  feature: z.string(),
  /** A single sentence of in-world knowledge the NPC can share about this node. */
  rumor: z.string().max(300),
});

export const RumorPayloadSchema = z.object({
  npcName: z.string(),
  disposition: z.number().int().min(-10).max(10),
  dispositionBand: z.enum(["Hostile", "Unfriendly", "Indifferent", "Friendly", "Helpful"]),
  rumors: z.array(RumorItemSchema),
  /** If disposition < 3 — explains why no rumors were shared. */
  refusalReason: z.string().optional(),
});

export type RumorItem = z.infer<typeof RumorItemSchema>;
export type RumorPayload = z.infer<typeof RumorPayloadSchema>;
```

### 4.5. Slice 1 Task Breakdown

| Task | File | Type | Depends On |
|------|------|------|------------|
| 1.1 Add `disposition Int?`, `personalityTags Json?`, `hasMetPlayer Boolean` fields to `NPC` model | `prisma/schema.prisma` | Schema | — |
| 1.2 Generate and apply migration `add_npc_social_fields` | `prisma/migrations/…` | Migration | 1.1 |
| 1.3 Create `lib/rules/social.ts` with `NPCPersonality` interface and `DISPOSITION_BANDS` constant | `lib/rules/social.ts` | Types | — |
| 1.4 Implement `getDispositionBand(disposition)` pure function | `lib/rules/social.ts` | Pure fn | 1.3 |
| 1.5 Define `ReactionRollInputSchema` (Zod) | `lib/rules/social.ts` | Schema | 1.3 |
| 1.6 Define `ReactionRollResultSchema` (Zod) | `lib/rules/social.ts` | Schema | 1.3 |
| 1.7 Define `SocialCheckInputSchema` (Zod) | `lib/rules/social.ts` | Schema | — |
| 1.8 Define `SocialCheckResultSchema` (Zod) | `lib/rules/social.ts` | Schema | — |
| 1.9 Define `GetRumorsInputSchema` (Zod) | `lib/rules/social.ts` | Schema | — |
| 1.10 Define `RumorItemSchema` and `RumorPayloadSchema` (Zod) | `lib/rules/social.ts` | Schema | — |
| 1.11 Write unit tests for all Zod schemas (valid inputs pass, invalid inputs throw) | `tests/rules/social.test.ts` | Tests | 1.5–1.10 |
| 1.12 Write unit tests for `getDispositionBand` (boundary values: −10, −7, −2, 0, 2, 7, 10) | `tests/rules/social.test.ts` | Tests | 1.4 |
| 1.13 `pnpm tsc --noEmit` passes clean | — | Validation | 1.1–1.10 |

### 4.6. Slice 1 Acceptance Criteria

- [ ] Migration `add_npc_social_fields` applies cleanly with zero errors.
- [ ] `NPC.disposition` defaults to `null` for all existing rows — no data loss.
- [ ] `NPC.hasMetPlayer` defaults to `false` for all existing rows.
- [ ] `getDispositionBand(-10)` returns `"Hostile"`.
- [ ] `getDispositionBand(-3)` returns `"Unfriendly"`.
- [ ] `getDispositionBand(0)` returns `"Indifferent"`.
- [ ] `getDispositionBand(5)` returns `"Friendly"`.
- [ ] `getDispositionBand(10)` returns `"Helpful"`.
- [ ] All Zod schemas parse valid inputs and reject each category of malformed input.
- [ ] `charismaModifier` outside `[-5, +5]` is rejected by `ReactionRollInputSchema`.
- [ ] `dispositionDelta` of 0 or 5 is rejected by `SocialCheckInputSchema`.
- [ ] `pnpm test` passes with full coverage of the new file.
- [ ] `pnpm tsc --noEmit` passes.

---

## 5. Slice 2 — Interaction Engine

**Priority:** P0 — Must complete before UI integration.
**Philosophy:** Pure math first. Database writes only in tool execute functions. No side effects in the pure engine.

### 5.1. `generateNPCPersonality(seed)` — Deterministic Personality Tags

Add to `lib/rules/social.ts`. This function is **pure** — the same seed always returns the same `NPCPersonality`.

```
function generateNPCPersonality(seed: string): NPCPersonality

  1. motivation   = pickSeeded(seed + ":motivation", MOTIVATIONS)
  2. secret       = pickSeeded(seed + ":secret",     SECRETS)
  3. distinctTrait= pickSeeded(seed + ":trait",      DISTINCTIVE_TRAITS)

  Return { motivation, secret, distinctiveTrait }
```

**Required tables** (define in `lib/rules/social.ts`):

```
MOTIVATIONS (≥ 20 entries):
  "To repay an old debt before they die."
  "To protect a family member no one else knows about."
  "To accumulate enough wealth to buy land and retire."
  "To prove themselves to a mentor who doubted them."
  "To find a cure for a slow illness that plagues them."
  "To uncover the truth behind a loved one's disappearance."
  "To atone for an act of cowardice they committed years ago."
  "To outlast every enemy who has ever wronged them."
  "To reach a place they have only ever read about in a book."
  "To keep a promise made to someone now dead."
  ... (≥ 10 more of the same depth and specificity)

SECRETS (≥ 20 entries):
  "They once betrayed a trusted friend to save their own life."
  "They can read and write, but hide it to appear nonthreatening."
  "They are secretly employed by the city watch as an informant."
  "They stole their current name from a dead stranger."
  "They owe money to people who will hurt their family if unpaid."
  "They witnessed a murder and chose to say nothing."
  "Their skill set was learned in prison."
  "They have a child in another settlement that they don't acknowledge."
  "They are slowly dying and have made peace with it."
  "They know the location of something valuable and illegal."
  ... (≥ 10 more)

DISTINCTIVE_TRAITS (≥ 20 entries):
  "Always touches the left side of their jaw when thinking."
  "Repeats the last three words of anything they hear before responding."
  "Keeps their hands folded behind their back at all times."
  "Smells faintly of woodsmoke, even indoors."
  "Refers to themselves in the second person when nervous."
  "Never maintains eye contact for more than two seconds."
  "Always knows exactly what time it is without checking a clock."
  "Counts things obsessively — stones in a wall, chairs in a room."
  "Has a habit of ending sentences with a question when uncertain."
  "Moves with startling silence despite their apparent size."
  ... (≥ 10 more)
```

### 5.2. `rollReaction(input)` — 2d6 Reaction Roll

Add to `lib/rules/social.ts`. This is a **pure** function (no I/O).

```
function rollReaction(input: ReactionRollInput): ReactionRollResult

  1. die1 = rollDie(6)    // from lib/rules/dice.ts
  2. die2 = rollDie(6)
  3. rawTotal = die1 + die2
  4. modifiedTotal = clamp(rawTotal + input.charismaModifier, 2, 14)
     // Clamp prevents CHA modifier from pushing below minimum possible (2) or
     // above the maximum useful band (14 is well into Helpful territory).

  5. Determine dispositionBand from DISPOSITION_BANDS:
       modifiedTotal 2–3   → Hostile
       modifiedTotal 4–5   → Unfriendly
       modifiedTotal 6–8   → Indifferent
       modifiedTotal 9–11  → Friendly
       modifiedTotal 12+   → Helpful

  6. initialDisposition = DISPOSITION_BANDS[band].initial

  7. personality = generateNPCPersonality(input.npcSeed)

  Return ReactionRollResult {
    dice: [die1, die2],
    rawTotal,
    modifiedTotal,
    charismaModifier: input.charismaModifier,
    dispositionBand,
    initialDisposition,
    personality,
  }
```

**OSR Philosophical note:** The 2d6 bell curve intentionally concentrates results in the Indifferent range (6–8). Extreme results (Hostile or Helpful) are rare. Charisma modifiers shift this distribution meaningfully: a CHA 18 party leader (+4 mod) has a reasonable chance of a Helpful greeting; a CHA 6 leader (−2 mod) will frequently face Unfriendly or worse opening attitudes.

### 5.3. `computeSocialDC(disposition, attempt, approach)` — Dynamic Difficulty

```
function computeSocialDC(
  disposition: number,
  attempt: number,           // how many points the player is trying to shift
  approach: "persuade" | "intimidate" | "deceive"
): number

  baseDC = 10
  
  // Hostile NPCs are harder to sway — every point below 0 adds 1 to DC.
  dispositionPenalty = Math.max(0, -disposition)

  // Bigger shifts are harder.
  ambitionPenalty = (attempt - 1) * 3   // delta 1 → +0, delta 2 → +3, delta 3 → +6, delta 4 → +9

  // Intimidation is marginally easier in raw numbers but has a backfire risk.
  approachModifier = approach === "intimidate" ? -2 : 0

  return baseDC + dispositionPenalty + ambitionPenalty + approachModifier
```

### 5.4. `resolveSocialCheck(input, charismaModifier, currentDisposition)` — Pure Resolution

```
function resolveSocialCheck(
  input: SocialCheckInput,
  charismaModifier: number,
  currentDisposition: number
): SocialCheckResult

  1. dc = computeSocialDC(currentDisposition, input.dispositionDelta, input.approach)
  2. checkResult = d20Check(charismaModifier, dc)         // from lib/rules/dice.ts
  3. natural = checkResult.roll.dice[0].result

  4. Determine disposition shift:
     a. Critical Success (natural 20): dispositionShift = input.dispositionDelta + 1
     b. Success:                        dispositionShift = input.dispositionDelta
     c. Critical Failure (natural 1):
          If approach === "intimidate": dispositionShift = -2  (backfire = true)
          Else:                         dispositionShift =  0
     d. Failure:
          If approach === "intimidate": dispositionShift = -1  (backfire = true)
          Else:                         dispositionShift =  0

  5. dispositionAfter = clamp(currentDisposition + dispositionShift, -10, 10)

  Return SocialCheckResult {
    approach,
    roll: natural,
    charismaModifier,
    total: checkResult.roll.total,
    dc,
    success: checkResult.success,
    isCriticalSuccess: checkResult.isCriticalSuccess,
    isCriticalFailure: checkResult.isCriticalFailure,
    dispositionBefore: currentDisposition,
    dispositionAfter,
    dispositionBandBefore: getDispositionBand(currentDisposition),
    dispositionBandAfter: getDispositionBand(dispositionAfter),
    backfire: input.approach === "intimidate" && !checkResult.success,
  }
```

### 5.5. `getRumorsPayload(npcSeed, npcName, disposition, nearbyNodes)` — Pure Rumor Builder

```
function getRumorsPayload(
  npcSeed: string,
  npcName: string,
  disposition: number,
  nearbyNodes: Array<{ id: string; name: string; feature: string; description: string }>
): RumorPayload

  1. If disposition < 3:
     Return { npcName, disposition, dispositionBand, rumors: [], refusalReason:
       disposition < -2 ? "This NPC is hostile and will not speak." :
       "This NPC is indifferent and unwilling to share information freely."
     }

  2. Filter nearbyNodes to those with feature !== "empty"
     → informativeNodes

  3. For each informativeNode:
     Build a RumorItem:
       nodeId:   node.id
       nodeName: node.name
       feature:  node.feature
       rumor:    buildRumorText(node.feature, node.name, node.description)

  4. buildRumorText(feature, name, description):
     // Maps feature tags to a diegetic rumor sentence.
     // The description is at most 120 chars of the node's actual DB description.
     // The narrator may paraphrase; may NOT invent content beyond this.
     
     "npc"         → "There's someone in {name} — {description excerpt}."
     "hazard"      → "Be careful near {name}. {description excerpt}."
     "treasure"    → "I've heard there's something worth finding in {name}."
     "quest_hook"  → "Trouble in {name}, if you're looking for work. {description excerpt}."
     "rest"        → "{name} is safe to rest in, from what I know."
     "shop"        → "You can buy supplies in {name}."
     "exit"        → "{name} leads out of this area."

  Return { npcName, disposition, dispositionBand, rumors }
```

### 5.6. AI Tool Integration — `rollReaction`

Add to `buildTools()` in `lib/ai/narrator.ts`:

```typescript
rollReaction: tool({
  description:
    "Perform the 2d6 AD&D 1e Reaction Roll to determine an NPC's initial disposition " +
    "toward the party when they are first approached. " +
    "MUST be called the FIRST TIME the party speaks to any NPC in a scene. " +
    "Do NOT call this if NPC.hasMetPlayer is true — use the persisted disposition instead. " +
    "The roll result determines the NPC's opening attitude. " +
    "The Narrator MUST voice the NPC using ONLY the returned dispositionBand and personality tags. " +
    "NEVER invent NPC attitudes, motivations, or secrets without calling this tool first. " +
    "Code is Law.",
  inputSchema: ReactionRollInputSchema,
  execute: async ({ npcSeed, npcRole, charismaModifier }) => {
    // 1. Call rollReaction({ npcSeed, npcRole, charismaModifier }) — pure function
    // 2. Upsert NPC record:
    //    - If not exists: create with statblock from generateNPC(npcSeed, npcRole)
    //    - Set disposition = result.initialDisposition
    //    - Set personalityTags = result.personality
    //    - Set hasMetPlayer = true
    // 3. Return ReactionRollResult JSON
  },
}),
```

### 5.7. AI Tool Integration — `socialCheck`

Add to `buildTools()` in `lib/ai/narrator.ts`:

```typescript
socialCheck: tool({
  description:
    "Resolve a social action — Persuade, Intimidate, or Deceive — against an NPC. " +
    "Rolls 1d20 + the character's CHA modifier against a DC derived from " +
    "the NPC's current disposition and the magnitude of the shift attempted. " +
    "On success, the NPC's disposition increases. Intimidation failure causes backfire. " +
    "MUST be called whenever the player attempts to influence an NPC through social means. " +
    "NEVER decide the outcome of a social interaction without calling this tool. " +
    "Narrate the result — and ONLY the result — that the tool returns. " +
    "Code is Law.",
  inputSchema: SocialCheckInputSchema,
  execute: async ({ npcSeed, characterId, approach, dispositionDelta, intent }) => {
    // 1. Fetch NPC by campaignId + seed → verify NPC.hasMetPlayer === true
    //    If not: return error "Call rollReaction before socialCheck."
    // 2. Fetch Character by characterId → extract CHA from stats JSON
    //    → charismaModifier = abilityModifier(stats.CHA ?? 10)
    // 3. currentDisposition = NPC.disposition ?? 0
    // 4. Call resolveSocialCheck(input, charismaModifier, currentDisposition) — pure
    // 5. Prisma transaction:
    //    prisma.nPC.update({ where: { campaignId_seed }, data: { disposition: result.dispositionAfter } })
    // 6. Return SocialCheckResult JSON
  },
}),
```

### 5.8. AI Tool Integration — `getRumors`

Add to `buildTools()` in `lib/ai/narrator.ts`:

```typescript
getRumors: tool({
  description:
    "Ask an NPC what they know about nearby areas. " +
    "Only NPCs with disposition ≥ 3 (Friendly or better) will share information. " +
    "The returned rumors are derived ENTIRELY from persisted database records — " +
    "the NPC cannot share information the world does not contain. " +
    "MUST be called when a player asks an NPC for directions, local knowledge, " +
    "rumors, or information about nearby locations. " +
    "NEVER invent rumors, location details, or quest hooks. " +
    "Narrate ONLY the information this tool returns. " +
    "Code is Law.",
  inputSchema: GetRumorsInputSchema,
  execute: async ({ npcSeed }) => {
    // 1. Fetch NPC disposition from DB (by campaignId + seed)
    // 2. Fetch Campaign.currentLocationId
    // 3. Fetch all LocationNodes WHERE locationId = currentLocationId
    //    (the NPC only knows about their own location's nodes)
    // 4. Call getRumorsPayload(npcSeed, npcName, disposition, nearbyNodes) — pure
    // 5. Return RumorPayload JSON (no DB writes — read-only tool)
  },
}),
```

### 5.9. Formatter Update — Social Interaction Mandate

Add to `formatIronLaws()` in `lib/memory/formatter.ts`:

```
"**Social Interaction Mandate:** When you first speak with any NPC in a scene " +
"(as determined by NPC.hasMetPlayer being false), you MUST call `rollReaction` " +
"with the party leader's Charisma modifier. Never invent the NPC's opening attitude. " +
"When the player attempts to persuade, intimidate, or deceive an NPC, you MUST call " +
"`socialCheck` before narrating the outcome. When the player asks an NPC for local " +
"information, rumors, or directions, you MUST call `getRumors`. " +
"The engine decides what the NPC knows and feels. You voice it. Code is Law."
```

### 5.10. Formatter Addition — `formatNPCContext()`

Add a new section builder to `lib/memory/formatter.ts` that injects NPC personality when the party is interacting with a known NPC:

```
function formatNPCContext(npc: {
  name: string;
  disposition: number | null;
  personalityTags: NPCPersonality | null;
  hasMetPlayer: boolean;
}): string

  If NPC.hasMetPlayer === false:
    Return "## 🎭 NPC: [name]\n*(Not yet met — call rollReaction before first interaction.)*"

  band = getDispositionBand(npc.disposition ?? 0)
  dispositionIcon = {
    Hostile: "🔴", Unfriendly: "🟠", Indifferent: "⚪",
    Friendly: "🟢", Helpful: "💛"
  }[band]

  Return:
    "## 🎭 NPC: {name}
     **Disposition:** {dispositionIcon} {band} ({npc.disposition})
     **Motivation:** {personalityTags.motivation}
     **Distinctive Trait:** {personalityTags.distinctiveTrait}
     *(Note: The NPC's secret is known to them but concealed from the party.
       Reveal it only if disposition reaches Helpful and the player asks the right question.)*"
```

### 5.11. Slice 2 Task Breakdown

| Task | File | Type | Depends On |
|------|------|------|------------|
| 2.1 Define `MOTIVATIONS`, `SECRETS`, `DISTINCTIVE_TRAITS` tables (≥ 20 entries each) | `lib/rules/social.ts` | Data | Slice 1 |
| 2.2 Implement `generateNPCPersonality(seed)` pure function | `lib/rules/social.ts` | Pure fn | 2.1 |
| 2.3 Implement `rollReaction(input)` pure function | `lib/rules/social.ts` | Pure fn | 2.2 |
| 2.4 Implement `computeSocialDC(disposition, attempt, approach)` pure function | `lib/rules/social.ts` | Pure fn | Slice 1 |
| 2.5 Implement `resolveSocialCheck(input, charismaModifier, currentDisposition)` pure function | `lib/rules/social.ts` | Pure fn | 2.4 |
| 2.6 Implement `getRumorsPayload(npcSeed, npcName, disposition, nearbyNodes)` pure function | `lib/rules/social.ts` | Pure fn | Slice 1 |
| 2.7 Unit test: `generateNPCPersonality` — same seed always returns same personality | `tests/rules/social.test.ts` | Tests | 2.2 |
| 2.8 Unit test: `generateNPCPersonality` — different seeds return different results | `tests/rules/social.test.ts` | Tests | 2.2 |
| 2.9 Unit test: `rollReaction` — CHA mod of +5 skews band distribution toward Friendly/Helpful | `tests/rules/social.test.ts` | Tests | 2.3 |
| 2.10 Unit test: `rollReaction` — CHA mod clamping prevents modified total below 2 | `tests/rules/social.test.ts` | Tests | 2.3 |
| 2.11 Unit test: `rollReaction` — result includes personality tags | `tests/rules/social.test.ts` | Tests | 2.3 |
| 2.12 Unit test: `computeSocialDC` — hostile NPC (−8 disp) has higher DC than neutral (0 disp) | `tests/rules/social.test.ts` | Tests | 2.4 |
| 2.13 Unit test: `computeSocialDC` — delta 4 has DC ≥ delta 1 + 9 | `tests/rules/social.test.ts` | Tests | 2.4 |
| 2.14 Unit test: `computeSocialDC` — Intimidate has lower base DC than Persuade | `tests/rules/social.test.ts` | Tests | 2.4 |
| 2.15 Unit test: `resolveSocialCheck` — successful Persuade shifts disposition up by delta | `tests/rules/social.test.ts` | Tests | 2.5 |
| 2.16 Unit test: `resolveSocialCheck` — failed Intimidate sets `backfire: true` and drops disposition | `tests/rules/social.test.ts` | Tests | 2.5 |
| 2.17 Unit test: `resolveSocialCheck` — disposition clamped at −10 and +10 | `tests/rules/social.test.ts` | Tests | 2.5 |
| 2.18 Unit test: `resolveSocialCheck` — Critical Success adds +1 to delta | `tests/rules/social.test.ts` | Tests | 2.5 |
| 2.19 Unit test: `getRumorsPayload` — returns `refusalReason` when disposition < 3 | `tests/rules/social.test.ts` | Tests | 2.6 |
| 2.20 Unit test: `getRumorsPayload` — returns only non-empty-feature nodes | `tests/rules/social.test.ts` | Tests | 2.6 |
| 2.21 Unit test: `getRumorsPayload` — each RumorItem uses node's own DB description | `tests/rules/social.test.ts` | Tests | 2.6 |
| 2.22 Add `rollReaction` tool to `buildTools()` with full execute implementation | `lib/ai/narrator.ts` | Tool | 2.3, Slice 1 |
| 2.23 Add `socialCheck` tool to `buildTools()` with full execute implementation | `lib/ai/narrator.ts` | Tool | 2.5, Slice 1 |
| 2.24 Add `getRumors` tool to `buildTools()` with full execute implementation | `lib/ai/narrator.ts` | Tool | 2.6, Slice 1 |
| 2.25 Add Social Interaction Mandate to `formatIronLaws()` | `lib/memory/formatter.ts` | Pure fn | — |
| 2.26 Implement `formatNPCContext()` section builder | `lib/memory/formatter.ts` | Pure fn | Slice 1 |
| 2.27 Update `formatSystemPrompt()` to include NPC context block when interacting with an NPC | `lib/memory/formatter.ts` | Pure fn | 2.26 |
| 2.28 Unit test: Social Mandate appears in Iron Laws output | `tests/memory/formatter.test.ts` | Tests | 2.25 |
| 2.29 Unit test: `formatNPCContext` renders disposition icon, band, and personality tags | `tests/memory/formatter.test.ts` | Tests | 2.26 |
| 2.30 Unit test: `formatNPCContext` — unmet NPC renders "call rollReaction" prompt | `tests/memory/formatter.test.ts` | Tests | 2.26 |

### 5.12. Slice 2 Acceptance Criteria

- [ ] `generateNPCPersonality("npc_gate_guard_01")` always returns the same three tags.
- [ ] `generateNPCPersonality("npc_gate_guard_01")` returns different tags than `generateNPCPersonality("npc_innkeeper_02")`.
- [ ] `rollReaction({ npcSeed: "x", npcRole: "commoner", charismaModifier: 0 })` returns a `dispositionBand` value and a non-null `personality` object.
- [ ] `rollReaction` with `charismaModifier: -5` never returns `modifiedTotal` below 2.
- [ ] `computeSocialDC(−8, 3, "persuade")` > `computeSocialDC(0, 3, "persuade")` (hostile is harder).
- [ ] `computeSocialDC(0, 1, "intimidate")` < `computeSocialDC(0, 1, "persuade")` by exactly 2.
- [ ] `resolveSocialCheck` with a mocked natural-20 roll returns `dispositionDelta + 1` shift.
- [ ] `resolveSocialCheck` with approach `"intimidate"` and a mocked failure returns `backfire: true` and `dispositionAfter < dispositionBefore`.
- [ ] `resolveSocialCheck` never allows `dispositionAfter` outside `[-10, +10]`.
- [ ] `getRumorsPayload` with `disposition: 2` returns empty `rumors[]` and a non-empty `refusalReason`.
- [ ] `getRumorsPayload` with `disposition: 5` returns `RumorItem[]` containing only nodes with feature ≠ `"empty"`.
- [ ] Each `RumorItem.rumor` contains text derived from the node's actual `description` field.
- [ ] `rollReaction` tool upserts the NPC record with `hasMetPlayer: true` and the initial disposition.
- [ ] `socialCheck` tool updates `NPC.disposition` in the database via a Prisma transaction.
- [ ] `getRumors` tool makes no database writes (read-only).
- [ ] Social Interaction Mandate appears in the Iron Laws output.
- [ ] `formatNPCContext` renders the `🔴`/`🟠`/`⚪`/`🟢`/`💛` icon for each disposition band.
- [ ] `pnpm test` passes with 100% coverage of `lib/rules/social.ts`.
- [ ] `pnpm tsc --noEmit` passes.

---

## 6. Slice 3 — VTT Dialogue UI: "The Senate" Overlay

**Priority:** P1 — Enhances the social experience after mechanics are solid.
**Philosophy:** Atmosphere first, information second, action always clear.

### 6.1. Component: `DialogueOverlay.tsx`

`components/social/DialogueOverlay.tsx`

A full-screen overlay component that renders when a `rollReaction` result is available. The component:

1. **Overlays the VTT** with a dark, semi-transparent backdrop (consistent with `TradeWindow`, `AscensionOverlay`, and `SpoilsOfWar` — same `z-index` tier and blur treatment).
2. **NPC portrait header:** NPC name, race, profession (derived from stored NPC data), and a disposition visual (an animated icon showing the current disposition band — see §6.2).
3. **Narration area:** A scrollable text box displaying the AI Narrator's most recent narration in a dark-parchment aesthetic. Updates as the narrative stream arrives.
4. **Personality sidebar** (collapsed by default, expandable): Shows `motivation` and `distinctiveTrait`. The `secret` is **never displayed** to the player — it is context for the Narrator only.
5. **Action buttons — Social Intents:** Three primary buttons for the player's social moves:
   - **Persuade** — `socialCheck({ approach: "persuade", dispositionDelta: 1, … })`
   - **Intimidate** — `socialCheck({ approach: "intimidate", dispositionDelta: 1, … })` — styled with a warning indicator (skull icon) to telegraph backfire risk.
   - **Deceive** — `socialCheck({ approach: "deceive", dispositionDelta: 1, … })`
6. **Custom intent input:** A text field + "Speak" button that lets the player type their own words. On submit, this appends the player's text to the chat message and the Narrator calls the appropriate `socialCheck`. Delta is always 1 for custom inputs (the player must explicitly escalate).
7. **Ask for Rumors button:** A `getRumors` trigger button, visible only when `dispositionBand` ≥ `"Friendly"`. Disabled with a lock icon and tooltip `"(NPC not yet friendly enough)"` when disposition < 3.
8. **Disposition bar:** A horizontal bar below the NPC name showing the current disposition value on a −10 to +10 spectrum. Animated — it slides left/right after each `socialCheck` resolves. Color: gradient from deep crimson (−10) → stone grey (0) → warm gold (+10).
9. **Leave Dialogue button:** `"End Conversation"` — closes the overlay and returns focus to the exploration view.

### 6.2. Disposition Visual Specification

```
DISPOSITION_ICONS = {
  Hostile:     "💀",  // Active threat
  Unfriendly:  "⚔️",  // Wary, hand on hilt
  Indifferent: "👁️",  // Watching, uncommitted
  Friendly:    "🤝",  // Open hand
  Helpful:     "⭐",  // Willing ally
}
```

The icon appears in the header and changes with a 300ms crossfade animation when disposition shifts band.

### 6.3. Visual Design Specification

```
┌───────────────────────────────────────────────────────────────────────────────┐
│  ░░░░░░░░░░░░░░░░░░░░░░ SEMI-TRANSPARENT OVERLAY ░░░░░░░░░░░░░░░░░░░░░░░░░░ │
│  ░░  ┌──────────────────────────────────────────────────────────────────┐ ░░ │
│  ░░  │                                                                  │ ░░ │
│  ░░  │  🤝  Brynn Ashford  ·  Dwarf  ·  Blacksmith                     │ ░░ │
│  ░░  │  ▰▰▰▰▰▰▰░░░░░░░░░░░░░░ Friendly (+4)                           │ ░░ │
│  ░░  │  ─────────────────────────────────────────────────────────────   │ ░░ │
│  ░░  │                                                                  │ ░░ │
│  ░░  │  "The dwarf sets down her hammer and sizes up the party with     │ ░░ │
│  ░░  │   the practiced eye of someone who has seen too many fools       │ ░░ │
│  ░░  │   carrying weapons they cannot use. 'What do you want?'          │ ░░ │
│  ░░  │   She's not unfriendly — just efficient."                        │ ░░ │
│  ░░  │                                                                  │ ░░ │
│  ░░  │  ─────────────────────────────────────────────────────────────   │ ░░ │
│  ░░  │  ┌─ Your words ─────────────────────────────────────────────┐   │ ░░ │
│  ░░  │  │  _____________________________________________  [Speak]   │   │ ░░ │
│  ░░  │  └──────────────────────────────────────────────────────────┘   │ ░░ │
│  ░░  │                                                                  │ ░░ │
│  ░░  │  ┌─ SOCIAL INTENT ─────────────────────────────────────────┐   │ ░░ │
│  ░░  │  │  [🗣 PERSUADE]  [💀 INTIMIDATE]  [🎭 DECEIVE]           │   │ ░░ │
│  ░░  │  └──────────────────────────────────────────────────────────┘   │ ░░ │
│  ░░  │                                                                  │ ░░ │
│  ░░  │  [⭐ Ask for Rumors]          [▸ Personality]  [End Conversation] │ ░░ │
│  ░░  │                                                                  │ ░░ │
│  ░░  └──────────────────────────────────────────────────────────────────┘ ░░ │
│  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │
└───────────────────────────────────────────────────────────────────────────────┘
```

### 6.4. Component Props

```typescript
interface DialogueOverlayProps {
  /** The NPC being interacted with. */
  npc: {
    id: string;
    name: string;
    race: string | null;
    profession: string | null;
    disposition: number;
    personalityTags: {
      motivation: string;
      secret: string;
      distinctiveTrait: string;
    } | null;
    hasMetPlayer: boolean;
  };

  /** The most recent AI Narrator narration text to display. */
  narrationText: string;

  /** The character performing the social actions — for CHA derivation context. */
  characterId: string;

  /** Called when the player submits a Speak action with their custom words. */
  onSpeak: (words: string, approach: "persuade" | "intimidate" | "deceive") => void;

  /** Called when the player clicks a Social Intent button. */
  onSocialIntent: (approach: "persuade" | "intimidate" | "deceive") => void;

  /** Called when the player clicks "Ask for Rumors". */
  onAskRumors: () => void;

  /** Called when the player clicks "End Conversation". */
  onClose: () => void;

  /** Whether a social check or rumor request is currently in flight. */
  isLoading: boolean;
}
```

### 6.5. State Management

`DialogueOverlay` is a **controlled** component. All state lives in the parent (the main game view). The overlay does not manage campaign state internally.

- `disposition` is read from the parent's campaign state (refreshed after each `socialCheck` tool call resolves).
- `narrationText` streams token-by-token from the parent's narrative stream — the overlay displays the live stream.
- `isLoading` disables all buttons while any tool is executing — prevents double-firing.

### 6.6. Animations

| Element | Animation | Spec |
|---------|-----------|------|
| Overlay mount | Fade in | 200ms ease-in |
| Overlay unmount | Fade out | 150ms ease-out |
| Disposition bar | Slide to new value | 400ms cubic-bezier(0.4, 0, 0.2, 1) |
| Disposition icon | Crossfade on band change | 300ms ease |
| Social Intent buttons | Subtle pulse on hover | 150ms scale(1.02) |
| Intimidate button | Warning shimmer on hover (red glow) | 200ms infinite |
| "Ask for Rumors" | Lock icon fade-out when unlocked | 250ms ease |
| Narration text | Token-by-token fade-in | 50ms per token |

### 6.7. Accessibility

- Overlay traps focus within the dialogue panel (same pattern as `TradeWindow.tsx`).
- `Escape` key triggers `onClose`.
- All interactive elements have `aria-label` attributes.
- Disposition bar has `role="meter"` with `aria-valuenow`, `aria-valuemin="-10"`, `aria-valuemax="10"`.
- Intimidate button includes `aria-describedby` pointing to a tooltip describing the backfire risk.

### 6.8. Slice 3 Task Breakdown

| Task | File | Type | Depends On |
|------|------|------|------------|
| 3.1 Create `components/social/` directory | — | Structure | — |
| 3.2 Create `DialogueOverlay.tsx` component skeleton with props interface | `components/social/DialogueOverlay.tsx` | Component | Slice 1 |
| 3.3 Implement NPC portrait header with name, race, profession, disposition icon | `DialogueOverlay.tsx` | Component | 3.2 |
| 3.4 Implement disposition bar: gradient spectrum, animated value slider | `DialogueOverlay.tsx` | Component | 3.3 |
| 3.5 Implement narration area: scrollable dark-parchment text box | `DialogueOverlay.tsx` | Component | 3.2 |
| 3.6 Implement personality sidebar: collapsed by default, expandable, shows motivation + trait only | `DialogueOverlay.tsx` | Component | 3.5 |
| 3.7 Implement Social Intent buttons: Persuade, Intimidate (warning style), Deceive | `DialogueOverlay.tsx` | Component | 3.2 |
| 3.8 Implement custom Speak input: text field + button, calls `onSpeak` | `DialogueOverlay.tsx` | Component | 3.7 |
| 3.9 Implement "Ask for Rumors" button: locked when disposition < 3, unlocked ≥ 3 | `DialogueOverlay.tsx` | Component | 3.2 |
| 3.10 Implement "End Conversation" dismiss button | `DialogueOverlay.tsx` | Component | 3.2 |
| 3.11 Add focus trap on mount, Escape key handler | `DialogueOverlay.tsx` | Accessibility | 3.2 |
| 3.12 Add `aria-label`, `role="meter"`, and `aria-describedby` attributes | `DialogueOverlay.tsx` | Accessibility | 3.3–3.9 |
| 3.13 Implement overlay mount/unmount fade animations | `DialogueOverlay.tsx` | CSS/Animation | 3.2 |
| 3.14 Implement disposition bar slide animation | `DialogueOverlay.tsx` | CSS/Animation | 3.4 |
| 3.15 Integrate `DialogueOverlay` into main game view: render when dialogue is active | `app/game/page.tsx` or equivalent | Integration | 3.10 |
| 3.16 Wire `onSpeak` and `onSocialIntent` to the Narrator API route | `app/game/page.tsx` | Integration | 3.15 |
| 3.17 Wire `onAskRumors` to trigger `getRumors` tool call | `app/game/page.tsx` | Integration | 3.15 |
| 3.18 Refresh `npc.disposition` in parent state after each `socialCheck` response | `app/game/page.tsx` | State | 3.16 |

### 6.9. Slice 3 Acceptance Criteria

- [ ] `DialogueOverlay` renders without errors when given a valid `DialogueOverlayProps`.
- [ ] NPC portrait header correctly displays name, race, and profession.
- [ ] Disposition icon is `💀` when `dispositionBand === "Hostile"` and `⭐` when `"Helpful"`.
- [ ] Disposition bar position reflects `disposition` value accurately across the `[-10, +10]` range.
- [ ] Bar slides with animation when disposition value changes.
- [ ] Personality sidebar is collapsed by default; expands on click; shows motivation and trait only (no secret).
- [ ] Intimidate button has a distinct warning style (red glow) visually differentiating it from Persuade and Deceive.
- [ ] "Ask for Rumors" button is disabled and shows a lock icon when `disposition < 3`.
- [ ] "Ask for Rumors" button is enabled and active when `disposition >= 3`.
- [ ] `isLoading: true` disables all buttons.
- [ ] Focus is trapped within the overlay on mount.
- [ ] `Escape` key fires `onClose`.
- [ ] Disposition bar has correct `aria-*` attributes.
- [ ] `pnpm tsc --noEmit` passes with no type errors in the new component.

---

## 7. Core Pillar: Code is Law — Enforcement Matrix

The following table documents every decision point in The Senate system and explicitly forbids AI narrator discretion where the engine must decide:

| Decision | Who Decides | Enforcement |
|----------|-------------|-------------|
| NPC's initial attitude toward the party | **Engine** (2d6 + CHA mod) | `rollReaction` tool MUST be called first |
| Whether a Persuade attempt succeeds | **Engine** (1d20 + CHA mod vs DC) | `socialCheck` tool MUST be called |
| Whether an Intimidate attempt backfires | **Engine** (failed Intimidate → backfire) | Encoded in `resolveSocialCheck()` |
| Whether an NPC is willing to share rumors | **Engine** (disposition ≥ 3 check) | `getRumors` returns `refusalReason` if below threshold |
| What a rumor says about a location | **Database** (persisted `LocationNode.description`) | `getRumorsPayload` reads only from DB nodes |
| NPC's personality (motivation, secret, trait) | **PRNG** (`generateNPCPersonality(seed)`) | Injected into system prompt; AI voices, not invents |
| Disposition persists between sessions | **Database** (`NPC.disposition` column) | Prisma write on every `rollReaction` and `socialCheck` |
| NPC secret is revealed to the player | **Disposition gate** (Helpful + right question) | `formatNPCContext()` withholds secret from player-facing context |

> **Absolute prohibitions:**  
> The AI Narrator may **never** state that an NPC "seems friendly" or "appears convinced" without first having received a `ReactionRollResult` or `SocialCheckResult` with a success indication.  
> The AI Narrator may **never** describe an NPC's motivation or secret without those tags having been returned by `rollReaction`.  
> The AI Narrator may **never** describe rumors about a location that were not returned by `getRumors`.

---

## 8. Test Coverage Requirement

Every pure function introduced in this Milestone must have 100% branch coverage. The minimum required test cases per function are:

| Function | Minimum Test Cases |
|----------|--------------------|
| `getDispositionBand` | 7 (each boundary: −10, −7, −2, 0, 3, 7, 10) |
| `generateNPCPersonality` | 3 (same seed = same result; different seeds = different; all fields present) |
| `rollReaction` | 5 (CHA −5, CHA 0, CHA +5; clamp floor; personality included) |
| `computeSocialDC` | 6 (hostile vs neutral; delta 1 vs 4; persuade vs intimidate) |
| `resolveSocialCheck` | 8 (success; failure; crit success; crit failure; intimidate backfire; disposition clamp ±10) |
| `getRumorsPayload` | 5 (disposition 2 = refusal; disposition 5 = rumors; empty nodes; only non-empty features; rumor text uses node data) |
| Schema validation | ≥ 3 per schema (valid pass; required field missing; boundary violation) |

All tests live in `tests/rules/social.test.ts`.
All formatter tests live in `tests/memory/formatter.test.ts` (extending the existing file).

---

## 9. Milestone Completion Checklist

A Milestone N execution may not be called complete until every item below is checked:

### Slice 1 — Data Layer
- [ ] `prisma/schema.prisma` has `disposition`, `personalityTags`, `hasMetPlayer` on `NPC`.
- [ ] Migration applied successfully (`prisma migrate deploy` clean).
- [ ] `lib/rules/social.ts` exists with all types, interfaces, and Zod schemas.
- [ ] `getDispositionBand()` implemented and tested.
- [ ] All Zod schemas have unit tests (valid + invalid).
- [ ] `pnpm test` green. `pnpm tsc --noEmit` green.

### Slice 2 — Interaction Engine
- [ ] `generateNPCPersonality()` implemented with ≥ 60 total table entries.
- [ ] `rollReaction()` implements the 2d6 + CHA mod formula per §5.2.
- [ ] `computeSocialDC()` implements the dynamic difficulty formula per §5.3.
- [ ] `resolveSocialCheck()` implements backfire, crit bonus, and disposition clamping per §5.4.
- [ ] `getRumorsPayload()` reads only from the `nearbyNodes` parameter — zero invented content.
- [ ] All three tools (`rollReaction`, `socialCheck`, `getRumors`) added to `buildTools()`.
- [ ] Each tool's `execute` function performs an appropriate Prisma read or write.
- [ ] Social Interaction Mandate added to `formatIronLaws()`.
- [ ] `formatNPCContext()` implemented and wired into `formatSystemPrompt()`.
- [ ] All engine unit tests pass with 100% branch coverage.
- [ ] `pnpm test` green. `pnpm tsc --noEmit` green.

### Slice 3 — VTT Dialogue UI
- [ ] `DialogueOverlay.tsx` exists and renders correctly with test props.
- [ ] Disposition bar animates on value change.
- [ ] Disposition icon changes on band change.
- [ ] Personality sidebar hides the NPC's `secret` field.
- [ ] Intimidate button has distinct warning styling.
- [ ] "Ask for Rumors" locked/unlocked based on disposition ≥ 3.
- [ ] Focus trap and Escape key working.
- [ ] All `aria-*` attributes present on interactive elements.
- [ ] Component wired into the main game view.
- [ ] `pnpm tsc --noEmit` green.

### Final Gate
- [ ] `pnpm test` passes with zero failures.
- [ ] `pnpm build` produces no type errors.
- [ ] Git commit with message: `feat(social): Milestone N — The Senate (NPC Disposition & Social Engine)`.

---

*Principal Architect sign-off: Milestone N specification complete. Proceed to Slice 1.*
