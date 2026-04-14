# Milestone M — "The Market" — NPC Trade & Dynamic Economy

> **Precedence:** This document is subordinate to `PROJECT_CONTEXT.md` §25 (Precedence Order) and explicit user instructions.
> **Status:** Approved for execution — slice by slice.
> **Prerequisite:** Milestone L (The Forge — Character Progression) — confirmed 100% closed and committed to git.

---

## 1. Objective

Implement an **NPC Trade & Dynamic Economy** system that activates when a player interacts with a merchant NPC at a `shop`-feature LocationNode. The system:

1. **Merchant Generation:** When the player enters a `shop` node or initiates a trade dialogue, the AI narrator **must** call a new `generateMerchant` tool that procedurally creates a merchant identity and inventory based on the merchant's **archetype** (e.g., Blacksmith, Alchemist, Fence, General Goods). The inventory is deterministic from the NPC's seed — the same seed always produces the same wares.
2. **The Transaction:** Players can **buy** items from the merchant (deducting gold from `Campaign.gold` and adding the item to the character's `InventoryItem` records) or **sell** items from their own loot (adding gold to `Campaign.gold` and removing the item from their inventory). All mutations are Prisma transactions — never narrative fiat.
3. **Economy Math:** Sell prices are always a **fraction** of the item's true value (50% by default — the merchant's cut). Buy prices are the item's full `valueGP` or **marked up** (110%–150% depending on archetype and rarity). The formulas are pure functions — deterministic and testable.
4. **Merchant Discovery:** The World Weaver (Milestone K-B) already generates `shop`-feature nodes with `npcSeed` values. This milestone wires those seeds to the `generateMerchant` pipeline, completing the loop from map generation → NPC instantiation → trade interaction.
5. **UI:** A cinematic **Trade Window** overlay component allows the player to visually browse the merchant's inventory, compare buy/sell prices, and execute transactions — all synced with the server in real-time.

### Design Pillars (inherited from PROJECT_CONTEXT.md)

| Pillar | Application in Milestone M |
|---|---|
| **Code is Law** | Prisma handles all gold and inventory state. The AI narrator may NEVER invent item prices, grant free items, or modify gold balances narratively. The `executeTrade` tool validates every transaction mathematically — buy price ≤ party gold, sell item exists in inventory. If the math fails, the trade is rejected. No exceptions. |
| **Readability beats spectacle** | The Trade Window must clearly communicate item prices, gold balance, and inventory changes. Price clarity > animation extravagance. |
| **Diegetic immersion** | Merchants are characters — they have names, personalities, and specialities derived from the NPC generation system. Trade dialogue should feel like bartering with a person, not browsing a spreadsheet. |
| **100% Test Coverage Requirement** | Every pure function must have comprehensive unit tests. Every Zod schema must have validation tests. No slice is complete until `pnpm test` passes with full coverage of the new code. |

---

## 2. Core Loop — Discover → Generate → Browse → Trade → Persist

```
  Player moves to a "shop" node via moveToNode()
          │
          ▼
  AI Narrator receives system prompt:
    "SHOP NODE. A merchant is present. You MUST call `generateMerchant` NOW."
          │
          ▼
  AI calls tool: generateMerchant({ npcSeed, archetype })
          │
          ▼
  ┌───────────────────────────────────────────────────────────────────┐
  │              lib/rules/trade.ts (pure)                           │
  │                                                                   │
  │  1. npcSeed → deterministic PRNG stream                          │
  │  2. archetype → template selection (blacksmith/alchemist/         │
  │     general/fence/arcanist)                                      │
  │  3. generateMerchantInventory(archetype, seed) →                 │
  │     a. Select item pool from the archetype's preference table    │
  │     b. Roll item count within archetype-specific bounds          │
  │     c. For each slot: pick item from pool, compute buy price     │
  │        (base valueGP × archetype markup modifier)                │
  │  4. buildMerchantPayload() → MerchantPayload                    │
  └───────────────────────────┬───────────────────────────────────────┘
                              │
                              ▼
                ┌─────────────────────────────┐
                │   MerchantPayload (JSON)     │
                │                             │
                │  npcSeed: string             │
                │  name: string                │
                │  archetype: MerchantArchetype│
                │  greeting: string            │
                │  inventory: TradeItem[]      │
                │  buyModifier: number         │
                │  sellModifier: number        │
                └──────────┬──────────────────┘
                           │
                           ▼
                Tool returns MerchantPayload to AI
                           │
                           ▼
                AI narrates merchant greeting + available wares
                (MUST use item names + prices from the payload)
                           │
                           ▼
                UI: "Trade Window" overlay renders
                Player can browse, buy, or sell
                           │
                           ▼
                Player selects action → AI calls executeTrade({
                  action: "buy" | "sell",
                  itemIndex / inventoryItemId,
                  quantity
                })
                           │
                           ▼
  ┌───────────────────────────────────────────────────────────────────┐
  │              executeTrade tool (validated)                        │
  │                                                                   │
  │  BUY:                                                             │
  │    1. buyPrice = computeBuyPrice(item.valueGP, buyModifier)       │
  │    2. Guard: Campaign.gold >= buyPrice × quantity                 │
  │    3. Prisma transaction:                                         │
  │       a. Campaign.gold -= buyPrice × quantity                    │
  │       b. Create InventoryItem for the character                  │
  │    4. Return TradeResultPayload                                  │
  │                                                                   │
  │  SELL:                                                            │
  │    1. sellPrice = computeSellPrice(item.valueGP, sellModifier)   │
  │    2. Guard: InventoryItem exists and belongs to this character   │
  │    3. Guard: quantity <= item.quantity                            │
  │    4. Prisma transaction:                                         │
  │       a. Campaign.gold += sellPrice × quantity                   │
  │       b. Decrement or delete InventoryItem                       │
  │    5. Return TradeResultPayload                                  │
  └───────────────────────────┬───────────────────────────────────────┘
                              │
                              ▼
                AI narrates the transaction result
                UI updates gold display + inventory
```

---

## 3. Existing Infrastructure Audit

### What exists (Milestone L baseline)

| Module | State | Relevance to Milestone M |
|--------|-------|--------------------------|
| `prisma/schema.prisma` | `Campaign.gold` — integer gold ledger (Milestone K-A) | **Foundation** — buy/sell transactions mutate this column |
| `prisma/schema.prisma` | `InventoryItem` — full item model with `properties: Json`, `type`, `quantity`, `equippedSlot` | **Foundation** — bought items become InventoryItem records; sold items are removed |
| `prisma/schema.prisma` | `NPC` — persistent NPC with `seed`, `role`, `profession`, `name` | **Integration** — merchant NPCs are persisted here with `role: "commoner"` and `profession: "merchant"` |
| `prisma/schema.prisma` | `LocationNode.feature === "shop"` with `npcSeed` | **Trigger** — World Weaver already generates shop nodes with NPC seeds |
| `lib/rules/npc.ts` | `generateNPC(seed, role)` — deterministic statblocks | **Reuse** — the merchant's identity (name, race, traits) is derived from this generator |
| `lib/rules/inventory.ts` | `InventoryItem` interface, `validateItem()`, `equipItem()`, `useConsumable()` | **Reuse** — bought items must pass `validateItem()` before DB insert |
| `lib/rules/loot.ts` | `LootItem`, `LootItemSchema`, loot tables by rarity | **Reuse** — merchant inventories draw from the same item pools + archetype-specific additions |
| `lib/rules/generators.ts` | `seededFloat()`, `pickSeeded()`, `cyrb53()` — deterministic PRNG | **Reuse** — all merchant generation uses this PRNG |
| `data/loot-tables.json` | Curated item pools by rarity (mundane → legendary) | **Reuse** — merchant stock draws from these tables, filtered by archetype |
| `lib/ai/narrator.ts` | `buildTools()` — tool registry for AI narrator | **Integration point** — new `generateMerchant` + `executeTrade` tools go here |
| `lib/memory/formatter.ts` | `formatIronLaws()`, `formatExploration()` — narrator constraint system | **Update point** — add Trade Generation Mandate |
| `components/character/InventoryPanel.tsx` | Existing inventory display component | **Reference** — Trade Window follows the same component architecture |
| `components/combat/SpoilsOfWar.tsx` | Overlay pattern with dark-fantasy aesthetic | **Pattern reference** — Trade Window reuses the overlay UX pattern |

### What is missing

1. **Merchant archetype system** — no `MerchantArchetype` type or archetype-specific inventory templates.
2. **Trade engine** — no `lib/rules/trade.ts` exists.
3. **`generateMerchant` AI tool** — the narrator has no way to create merchant inventories.
4. **`executeTrade` AI tool** — the narrator has no way to resolve buy/sell transactions.
5. **Trade Generation Mandate** in Iron Laws — the AI is not yet constrained to use trade tools at shop nodes.
6. **Buy/Sell price formulas** — no `computeBuyPrice()` or `computeSellPrice()` pure functions.
7. **"Trade Window" UI** — no overlay component for browsing and transacting with merchants.
8. **Merchant-specific item pools** — blacksmiths should stock weapons/armor, alchemists potions, etc.
9. **`TradeItem` schema** — no Zod schema for items within a merchant inventory (with computed prices).
10. **`TradeAction` schema** — no Zod schema for the buy/sell transaction input.

---

## 4. Slice 1 — Data Layer

**Priority:** P0 — Must be first. All other slices depend on this.
**Philosophy:** Schema first, types second, validation third. No business logic in this slice.

### 4.1. Prisma Schema Assessment

**No new Prisma models are required.** The existing schema already provides all necessary infrastructure:

- `Campaign.gold` — party wealth ledger (Milestone K-A).
- `InventoryItem` — item records linked to a Character.
- `NPC` — persistent merchant identity with `seed`, `role`, `profession`.
- `LocationNode` — shop nodes with `feature: "shop"` and `npcSeed`.

Merchant inventory is **ephemeral** — generated deterministically from the NPC seed on demand and never persisted as a separate table. This is consistent with the "State is Truth" pattern: the seed IS the inventory. Purchased items graduate into `InventoryItem` records.

**Why no `MerchantInventory` table?** — Because `generateMerchant(seed, archetype)` is pure. The same (seed, archetype) pair always produces the same inventory. Storing it would duplicate derivable state. If we later need to track merchant stock depletion (items bought out), that becomes a future Milestone extension.

### 4.2. Merchant Archetype System

Define in `lib/rules/trade.ts`:

```typescript
export const MERCHANT_ARCHETYPES = [
  "blacksmith",     // Weapons, armor, shields — martial goods
  "alchemist",      // Potions, consumables, reagents
  "general",        // Mixed mundane goods — rope, rations, torches
  "fence",          // Stolen goods, rare curiosities — better sell prices, shady markup
  "arcanist",       // Spell scrolls, magical components, enchanted trinkets
] as const;

export type MerchantArchetype = (typeof MERCHANT_ARCHETYPES)[number];
```

### 4.3. Archetype Configuration Constants

Define in `lib/rules/trade.ts`:

```typescript
export interface MerchantArchetypeConfig {
  /** Display label for the archetype, e.g. "Blacksmith" */
  label: string;
  /** Multiplier applied to base item valueGP for buy prices. [1.0 .. 1.5] */
  buyModifier: number;
  /** Multiplier applied to base item valueGP for sell prices. [0.3 .. 0.6] */
  sellModifier: number;
  /** Item types this archetype stocks — filters the loot tables. */
  preferredTypes: ItemType[];
  /** Rarity tiers this archetype can stock — caps inventory quality. */
  maxRarity: LootRarity;
  /** Minimum number of items in stock. */
  inventoryMin: number;
  /** Maximum number of items in stock. */
  inventoryMax: number;
  /** Curated greeting templates for diegetic flavor. */
  greetings: string[];
}

export const ARCHETYPE_CONFIGS: Readonly<Record<MerchantArchetype, MerchantArchetypeConfig>> = {
  blacksmith: {
    label: "Blacksmith",
    buyModifier: 1.1,       // 10% markup — honest trade
    sellModifier: 0.5,      // 50% of value — standard
    preferredTypes: ["weapon", "armor"],
    maxRarity: "rare",
    inventoryMin: 4,
    inventoryMax: 8,
    greetings: [
      "Steel and sweat, friend. What do you need forged?",
      "The anvil's still warm. Come, see what I've hammered out.",
      "You look like someone who knows the weight of a good blade.",
    ],
  },
  alchemist: {
    label: "Alchemist",
    buyModifier: 1.2,       // 20% markup — specialized knowledge
    sellModifier: 0.4,      // 40% — alchemists are picky buyers
    preferredTypes: ["consumable"],
    maxRarity: "rare",
    inventoryMin: 5,
    inventoryMax: 10,
    greetings: [
      "Careful with that one — it bites. What ailment troubles you?",
      "Vapors and vials, friend. Everything measured twice.",
      "I've distilled something new. Want a look before I sell out?",
    ],
  },
  general: {
    label: "General Goods",
    buyModifier: 1.0,       // No markup — competitive pricing
    sellModifier: 0.5,      // 50% — standard
    preferredTypes: ["consumable", "misc"],
    maxRarity: "uncommon",
    inventoryMin: 6,
    inventoryMax: 12,
    greetings: [
      "Rope, rations, lanterns — I've got the lot.",
      "Nothing fancy, but everything you'll wish you'd bought later.",
      "Take a look around. Fair prices, honest weights.",
    ],
  },
  fence: {
    label: "Fence",
    buyModifier: 1.5,       // 50% markup — high risk goods
    sellModifier: 0.6,      // 60% — fences pay more for stolen goods
    preferredTypes: ["weapon", "misc"],
    maxRarity: "very_rare",
    inventoryMin: 3,
    inventoryMax: 7,
    greetings: [
      "Keep your voice down. Let me see what you've got.",
      "I don't ask where it came from. You don't ask where it goes.",
      "Rare goods, friend. The kind that don't exist on any ledger.",
    ],
  },
  arcanist: {
    label: "Arcanist",
    buyModifier: 1.3,       // 30% markup — arcane knowledge has a price
    sellModifier: 0.35,     // 35% — arcanists lowball mundane goods
    preferredTypes: ["spell", "misc", "consumable"],
    maxRarity: "very_rare",
    inventoryMin: 3,
    inventoryMax: 6,
    greetings: [
      "The weave recognises you. Perhaps you'll appreciate my collection.",
      "Careful what you touch — some of these are... temperamental.",
      "Knowledge is the true currency. Gold is merely the medium.",
    ],
  },
};
```

### 4.4. Zod Schemas for Tool I/O

#### GenerateMerchant input schema:

```typescript
export const GenerateMerchantInputSchema = z.object({
  npcSeed: z
    .string()
    .min(1)
    .describe(
      "The NPC seed from the shop node's `npcSeed` field. " +
      "Deterministically generates the merchant identity and inventory. " +
      "MUST match the current shop node's npcSeed."
    ),
  archetype: z
    .enum(MERCHANT_ARCHETYPES)
    .describe(
      "The merchant's specialisation. Determines inventory composition, " +
      "pricing modifiers, and greeting flavor. " +
      "Choose based on the LocationNode context: " +
      "blacksmith for forges, alchemist for apothecaries, fence for back-alleys, " +
      "arcanist for arcane shops, general for general stores."
    ),
});

export type GenerateMerchantInput = z.infer<typeof GenerateMerchantInputSchema>;
```

#### TradeItem schema (an item as it appears in the merchant's inventory with computed price):

```typescript
export const TradeItemSchema = z.object({
  /** Index within the merchant's inventory — used for buy actions. */
  index: z.number().int().nonnegative(),
  name: z.string(),
  type: z.enum(["weapon", "armor", "consumable", "spell", "misc"]),
  rarity: z.enum(["mundane", "uncommon", "rare", "very_rare", "legendary"]),
  description: z.string().max(200),
  properties: z.record(z.string(), z.unknown()),
  /** The item's intrinsic value in GP — canonical reference price. */
  baseValueGP: z.number().int().nonnegative(),
  /** The price the player must pay to BUY this item. baseValueGP × buyModifier. */
  buyPriceGP: z.number().int().nonnegative(),
});

export type TradeItem = z.infer<typeof TradeItemSchema>;
```

#### MerchantPayload schema (returned by `generateMerchant`):

```typescript
export const MerchantPayloadSchema = z.object({
  npcSeed: z.string(),
  name: z.string(),
  archetype: z.enum(MERCHANT_ARCHETYPES),
  greeting: z.string().max(300),
  inventory: z.array(TradeItemSchema),
  /** Multiplier applied to base valueGP for buy prices. Already baked into TradeItem.buyPriceGP. */
  buyModifier: z.number().positive(),
  /** Multiplier applied to base valueGP for sell prices. Used by executeTrade for selling. */
  sellModifier: z.number().positive().max(1),
});

export type MerchantPayload = z.infer<typeof MerchantPayloadSchema>;
```

#### TradeAction input schema (for `executeTrade` tool):

```typescript
export const TradeActionSchema = z.object({
  action: z
    .enum(["buy", "sell"])
    .describe(
      "Whether the player is BUYING from the merchant or SELLING to the merchant."
    ),
  /** For BUY: the item index in the merchant's inventory (from MerchantPayload.inventory[].index). */
  itemIndex: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe("Required for BUY actions. The merchant inventory item index."),
  /** For SELL: the player's InventoryItem ID to sell. */
  inventoryItemId: z
    .string()
    .min(1)
    .optional()
    .describe("Required for SELL actions. The character's InventoryItem.id."),
  quantity: z
    .number()
    .int()
    .min(1)
    .default(1)
    .describe("Number of units to buy or sell. Defaults to 1."),
  /** The merchant's npcSeed — required to reconstruct the merchant inventory for validation. */
  npcSeed: z
    .string()
    .min(1)
    .describe("The merchant's npcSeed. Used to reconstruct and validate the merchant inventory."),
  /** The merchant's archetype — required to reconstruct pricing. */
  archetype: z
    .enum(MERCHANT_ARCHETYPES)
    .describe("The merchant's archetype. Used to derive buy/sell modifiers."),
});

export type TradeAction = z.infer<typeof TradeActionSchema>;
```

#### TradeResult payload (returned by `executeTrade`):

```typescript
export const TradeResultSchema = z.object({
  success: z.boolean(),
  action: z.enum(["buy", "sell"]),
  itemName: z.string(),
  quantity: z.number().int().min(1),
  /** Gold exchanged in this transaction. */
  goldDelta: z.number().int(),
  /** Party gold AFTER the transaction. */
  newGoldBalance: z.number().int().nonnegative(),
  /** Error message if success === false. */
  error: z.string().optional(),
});

export type TradeResult = z.infer<typeof TradeResultSchema>;
```

### 4.5. Slice 1 Task Breakdown

| Task | File | Type | Depends On |
|------|------|------|------------|
| 1.1 Create `lib/rules/trade.ts` with `MerchantArchetype` type and `MERCHANT_ARCHETYPES` const | `lib/rules/trade.ts` | Types | — |
| 1.2 Define `ARCHETYPE_CONFIGS` constant (all 5 archetypes with modifiers, types, rarity caps, greetings) | `lib/rules/trade.ts` | Data | 1.1 |
| 1.3 Define `GenerateMerchantInputSchema` (Zod) | `lib/rules/trade.ts` | Schema | 1.1 |
| 1.4 Define `TradeItemSchema` (Zod) | `lib/rules/trade.ts` | Schema | — |
| 1.5 Define `MerchantPayloadSchema` (Zod) | `lib/rules/trade.ts` | Schema | 1.4 |
| 1.6 Define `TradeActionSchema` (Zod) | `lib/rules/trade.ts` | Schema | 1.1 |
| 1.7 Define `TradeResultSchema` (Zod) | `lib/rules/trade.ts` | Schema | — |
| 1.8 Write unit tests for all Zod schemas (valid + invalid inputs, edge cases, boundary values) | `tests/rules/trade.test.ts` | Tests | 1.3–1.7 |
| 1.9 Type-check: `pnpm tsc --noEmit` | — | Validation | 1.1–1.7 |

### 4.6. Acceptance Criteria

- [ ] `MerchantArchetype` type covers all 5 archetypes: blacksmith, alchemist, general, fence, arcanist.
- [ ] `ARCHETYPE_CONFIGS` provides `buyModifier`, `sellModifier`, `preferredTypes`, `maxRarity`, `inventoryMin`, `inventoryMax`, and `greetings` for every archetype.
- [ ] All Zod schemas parse valid inputs and reject malformed ones.
- [ ] Schema tests cover: empty `npcSeed`, invalid archetype strings, negative `buyPriceGP`, negative quantity, quantity 0 (rejected — min 1), missing required fields for buy vs. sell actions, oversized descriptions.
- [ ] `ARCHETYPE_CONFIGS.fence.sellModifier` > all other archetypes' `sellModifier` (fences pay more).
- [ ] `ARCHETYPE_CONFIGS.general.buyModifier` === 1.0 (no markup on general goods).
- [ ] `pnpm test` passes.
- [ ] `pnpm tsc --noEmit` passes.

---

## 5. Slice 2 — The Trade Engine

**Priority:** P0 — Must complete before UI integration.
**Philosophy:** Pure math first, tool integration second. Every function deterministic given a seed.

### 5.1. `computeBuyPrice()` — Markup Formula

```
function computeBuyPrice(baseValueGP: number, buyModifier: number): number

  price = Math.ceil(baseValueGP * buyModifier)
  return Math.max(1, price)
```

Guarantees: `buyPrice >= 1` always. Ceil rounding ensures the merchant never rounds down (merchant-favorable).

### 5.2. `computeSellPrice()` — Discount Formula

```
function computeSellPrice(baseValueGP: number, sellModifier: number): number

  price = Math.floor(baseValueGP * sellModifier)
  return Math.max(1, price)
```

Guarantees: `sellPrice >= 1` always (even worthless items yield 1 GP minimum — mercy rule). Floor rounding ensures the merchant never overpays (merchant-favorable).

**Key economic invariant:** `computeSellPrice(v, sellMod) < computeBuyPrice(v, buyMod)` for all items with `baseValueGP > 0` and standard modifiers. This prevents infinite gold exploits (buy → sell → profit). Specifically:

- Buy at 110% of value, sell at 50% → net loss of 60% per cycle.
- Even the fence (buy 150%, sell 60%) maintains a spread: buy at 150, sell at 60 → net loss of 90 GP per 100 GP of value.

### 5.3. `generateMerchantInventory()` — Archetype-Filtered Item Pool

```
function generateMerchantInventory(
  archetype: MerchantArchetype,
  seed: string
): TradeItem[]

  1. config = ARCHETYPE_CONFIGS[archetype]
  2. itemCount = seededInt(seed + ":count", config.inventoryMin, config.inventoryMax)

  3. Build filtered item pool:
     a. Load all items from loot-tables.json across all rarity tiers
        up to and including config.maxRarity.
     b. Filter to items whose `type` is in config.preferredTypes.
     c. This is the archetypePool.

  4. For each slot i in [0..itemCount):
     a. Pick item from archetypePool using pickSeeded(seed + ":item:" + i, archetypePool)
     b. buyPriceGP = computeBuyPrice(item.valueGP, config.buyModifier)
     c. Construct TradeItem with index = i, baseValueGP = item.valueGP, buyPriceGP

  5. Deduplicate — if the same item name appears twice, bump the seed salt
     and re-pick for the duplicate slot (merchants don't stock two identical items).

  Return TradeItem[]
```

This function is **pure** — the same (archetype, seed) always produces the same inventory.

**Design note on archetype pools:**
- **Blacksmith** draws from `weapon` and `armor` entries across mundane/uncommon/rare.
- **Alchemist** draws from `consumable` entries (potions, salves, antidotes).
- **General** draws from `consumable` + `misc` entries at mundane/uncommon only.
- **Fence** draws from `weapon` + `misc` at all tiers up to very_rare (the good stuff).
- **Arcanist** draws from `spell` + `misc` + `consumable` entries that have magical properties.

### 5.4. `buildMerchantPayload()` — Orchestrator

```
function buildMerchantPayload(input: {
  npcSeed: string;
  archetype: MerchantArchetype;
}): MerchantPayload

  1. npcStatblock = generateNPC(input.npcSeed, "commoner")
     // Reuse existing NPC generator for name, race, traits.
     // Role "commoner" — merchants are civilians.

  2. config = ARCHETYPE_CONFIGS[input.archetype]

  3. inventory = generateMerchantInventory(input.archetype, input.npcSeed)

  4. greeting = pickSeeded(input.npcSeed + ":greet", config.greetings)

  5. Validate payload against MerchantPayloadSchema

  Return {
    npcSeed: input.npcSeed,
    name: npcStatblock.name,
    archetype: input.archetype,
    greeting,
    inventory,
    buyModifier: config.buyModifier,
    sellModifier: config.sellModifier,
  }
```

This function is **pure** (aside from the NPC name generation which is itself pure).

### 5.5. Merchant-Specific Item Data

Extend `data/loot-tables.json` with additional entries if the existing pools lack coverage for certain archetypes. Specifically:

- **Consumable pool must have ≥ 10 entries** (currently may be sparse) — add healing potions, antidotes, oil of sharpness.
- **Spell pool** — add spell scrolls if not present (Shield, Cure Wounds, Detect Magic, etc.).
- **Misc pool** — ensure mundane adventuring gear exists (rope, torches, rations, lockpicks).

New entries follow the same curation rule: evocative diegetic names, ≤200 char descriptions, dark-fantasy tone.

### 5.6. AI Tool Integration — `generateMerchant`

Add to `buildTools()` in `lib/ai/narrator.ts`:

```typescript
generateMerchant: tool({
  description:
    "Generate a merchant's identity and inventory when the player interacts " +
    "with a shop node NPC. Returns the merchant's name, greeting, and a list " +
    "of items for sale with computed prices. " +
    "MUST be called when the player is at a 'shop' feature node and initiates trade. " +
    "NEVER invent items, prices, or merchant identities. " +
    "Use the node's npcSeed to ensure deterministic generation. " +
    "After calling, narrate the merchant using the returned name and greeting. " +
    "Present items using ONLY the names and prices from the response. " +
    "Code is Law.",
  inputSchema: GenerateMerchantInputSchema,
  execute: async ({ npcSeed, archetype }) => {
    // 1. Call buildMerchantPayload({ npcSeed, archetype })
    // 2. Validate payload against MerchantPayloadSchema
    // 3. Upsert NPC record in DB (if not already persisted from World Weaver)
    //    with role: "commoner", profession: archetype (e.g. "blacksmith")
    // 4. Return MerchantPayload JSON
  },
})
```

### 5.7. AI Tool Integration — `executeTrade`

Add to `buildTools()` in `lib/ai/narrator.ts`:

```typescript
executeTrade: tool({
  description:
    "Execute a buy or sell transaction with a merchant. " +
    "BUY: Deducts gold from the party and adds the item to the character's inventory. " +
    "SELL: Adds gold to the party and removes the item from the character's inventory. " +
    "The transaction MUST pass mathematical validation — if the party doesn't have " +
    "enough gold, or the item doesn't exist, the trade fails and returns an error. " +
    "NEVER grant items or gold without calling this tool. Code is Law.",
  inputSchema: TradeActionSchema,
  execute: async ({ action, itemIndex, inventoryItemId, quantity, npcSeed, archetype }) => {
    // === BUY ===
    // 1. Reconstruct merchant inventory: buildMerchantPayload({ npcSeed, archetype })
    // 2. Resolve TradeItem from inventory[itemIndex]
    // 3. totalCost = item.buyPriceGP * quantity
    // 4. Fetch Campaign.gold
    // 5. Guard: Campaign.gold >= totalCost → if not, return { success: false, error: "Insufficient gold" }
    // 6. Prisma transaction:
    //    a. Campaign.gold -= totalCost
    //    b. Upsert InventoryItem (if same item exists, increment quantity; else create new)
    //       Properties, type, name all come from the TradeItem.
    // 7. Return TradeResult

    // === SELL ===
    // 1. Fetch InventoryItem by inventoryItemId + verify characterId ownership
    // 2. Guard: item.quantity >= quantity
    // 3. Lookup item's base valueGP from its properties
    //    (items store valueGP in properties.valueGP or we derive from loot table)
    // 4. config = ARCHETYPE_CONFIGS[archetype]
    // 5. sellPrice = computeSellPrice(baseValueGP, config.sellModifier) * quantity
    // 6. Prisma transaction:
    //    a. Campaign.gold += sellPrice
    //    b. If item.quantity === quantity: delete InventoryItem
    //       Else: decrement InventoryItem.quantity
    // 7. Return TradeResult
  },
})
```

### 5.8. Sell Price Discovery — `valueGP` on InventoryItems

For items to be sellable, their base `valueGP` must be retrievable. Two strategies:

1. **Loot-generated items** — already stored in `properties.valueGP` (set by `generateLootPayload()`).
2. **Starting equipment / manually created items** — may lack `valueGP`. Default to `0` (unsellable) unless the merchant archetype has a `miscFallbackValue` (future extension).

Add a helper:

```
function getItemBaseValue(item: InventoryItem): number

  If item.properties has a numeric `valueGP` field:
    return item.properties.valueGP
  Else:
    return 0  // Priceless (to the player) or worthless (to the merchant)
```

### 5.9. Formatter Update — Trade Generation Mandate

Add to `formatIronLaws()` in `lib/memory/formatter.ts`:

```
"**Trade Generation Mandate:** When the player is at a 'shop' node and " +
"initiates trade or conversation with a merchant, you MUST call `generateMerchant` " +
"with the node's npcSeed and an appropriate archetype. " +
"NEVER invent merchant names, item prices, or inventory. " +
"When the player wants to buy or sell, call `executeTrade` with the precise " +
"item index, quantity, and action. " +
"NEVER grant items or modify gold without the trade tool confirming success. " +
"If a trade fails (insufficient gold, item not found), narrate the failure — " +
"do NOT override the system. Code is Law."
```

### 5.10. Formatter Addition — `formatShopNode()`

Add a new helper to `lib/memory/formatter.ts` that enriches the exploration section when the current node is a shop:

```
function formatShopNode(merchantPayload: MerchantPayload | null): string

  If no active merchant: return ""

  Return:
    "## 🏪 Merchant: [name] — [archetype label]
     [greeting]

     **Available Wares:**
     | # | Item | Type | Rarity | Buy Price |
     |---|------|------|--------|-----------|
     | 0 | Blade of Bitter Resolve | weapon | rare | 550 GP |
     | 1 | Healing Salve | consumable | mundane | 5 GP |
     ...

     **Sell Modifier:** [sellModifier × 100]% of item value
     **Party Gold:** [Campaign.gold] GP

     To BUY: call `executeTrade` with action \"buy\", itemIndex, quantity.
     To SELL: call `executeTrade` with action \"sell\", inventoryItemId, quantity."
```

### 5.11. Slice 2 Task Breakdown

| Task | File | Type | Depends On |
|------|------|------|------------|
| 2.1 Implement `computeBuyPrice(baseValueGP, buyModifier)` | `lib/rules/trade.ts` | Pure fn | Slice 1 |
| 2.2 Implement `computeSellPrice(baseValueGP, sellModifier)` | `lib/rules/trade.ts` | Pure fn | Slice 1 |
| 2.3 Implement `getItemBaseValue(item)` helper | `lib/rules/trade.ts` | Pure fn | — |
| 2.4 Implement `generateMerchantInventory(archetype, seed)` | `lib/rules/trade.ts` | Pure fn | 2.1 |
| 2.5 Implement `buildMerchantPayload({ npcSeed, archetype })` orchestrator | `lib/rules/trade.ts` | Pure fn | 2.4 |
| 2.6 Add/extend `data/loot-tables.json` with consumable, spell, and misc entries if needed | `data/loot-tables.json` | Data | — |
| 2.7 Write unit test: `computeBuyPrice` — ceil rounding, minimum 1 GP, various modifiers | `tests/rules/trade.test.ts` | Tests | 2.1 |
| 2.8 Write unit test: `computeSellPrice` — floor rounding, minimum 1 GP, various modifiers | `tests/rules/trade.test.ts` | Tests | 2.2 |
| 2.9 Write unit test: **economic invariant** — `sellPrice < buyPrice` for all items with standard modifiers | `tests/rules/trade.test.ts` | Tests | 2.1, 2.2 |
| 2.10 Write unit test: `generateMerchantInventory` — item count within archetype bounds, types match preferredTypes, rarity ≤ maxRarity | `tests/rules/trade.test.ts` | Tests | 2.4 |
| 2.11 Write unit test: `generateMerchantInventory` — determinism: same seed always produces same inventory | `tests/rules/trade.test.ts` | Tests | 2.4 |
| 2.12 Write unit test: `generateMerchantInventory` — no duplicate item names in a single inventory | `tests/rules/trade.test.ts` | Tests | 2.4 |
| 2.13 Write unit test: `buildMerchantPayload` — validates against `MerchantPayloadSchema` | `tests/rules/trade.test.ts` | Tests | 2.5 |
| 2.14 Write unit test: `buildMerchantPayload` — each archetype produces a valid payload | `tests/rules/trade.test.ts` | Tests | 2.5 |
| 2.15 Write unit test: `getItemBaseValue` — returns `valueGP` from properties, defaults to 0 | `tests/rules/trade.test.ts` | Tests | 2.3 |
| 2.16 Add `generateMerchant` tool to `buildTools()` in narrator | `lib/ai/narrator.ts` | Tool | 2.5, Slice 1 |
| 2.17 Implement `generateMerchant` tool execute function (generate → upsert NPC → return) | `lib/ai/narrator.ts` | Async | 2.16 |
| 2.18 Add `executeTrade` tool to `buildTools()` in narrator | `lib/ai/narrator.ts` | Tool | 2.1, 2.2, Slice 1 |
| 2.19 Implement `executeTrade` tool execute function (validate → Prisma tx → return) | `lib/ai/narrator.ts` | Async | 2.18 |
| 2.20 Add Trade Generation Mandate to `formatIronLaws()` | `lib/memory/formatter.ts` | Pure fn | — |
| 2.21 Implement `formatShopNode()` section builder | `lib/memory/formatter.ts` | Pure fn | — |
| 2.22 Update `formatExploration()` / `formatSystemPrompt()` to include shop section when at a shop node | `lib/memory/formatter.ts` | Pure fn | 2.21 |
| 2.23 Write formatter tests for Trade Mandate and shop section | `tests/memory/formatter.test.ts` | Tests | 2.20, 2.21 |

### 5.12. Acceptance Criteria

- [ ] `computeBuyPrice(100, 1.1)` returns `110`. `computeBuyPrice(0, 1.5)` returns `1` (minimum).
- [ ] `computeSellPrice(100, 0.5)` returns `50`. `computeSellPrice(1, 0.5)` returns `1` (minimum).
- [ ] **Economic invariant:** For every item in loot-tables.json and every archetype, `computeSellPrice(v, config.sellModifier) < computeBuyPrice(v, config.buyModifier)`.
- [ ] `generateMerchantInventory("blacksmith", seed)` returns only `weapon` and `armor` type items.
- [ ] `generateMerchantInventory("general", seed)` never returns items with rarity > `uncommon`.
- [ ] `generateMerchantInventory` item count ∈ `[config.inventoryMin, config.inventoryMax]` for all archetypes.
- [ ] `generateMerchantInventory` is deterministic — same (archetype, seed) always returns identical inventory.
- [ ] `buildMerchantPayload` produces a valid `MerchantPayload` for all 5 archetypes.
- [ ] No duplicate item names within a single merchant inventory.
- [ ] `generateMerchant` tool upserts the NPC record in the database.
- [ ] `executeTrade` BUY: deducts correct gold, creates `InventoryItem`, returns `TradeResult`.
- [ ] `executeTrade` BUY: rejects transaction when `Campaign.gold < totalCost` with `success: false`.
- [ ] `executeTrade` SELL: adds correct gold, removes/decrements `InventoryItem`, returns `TradeResult`.
- [ ] `executeTrade` SELL: rejects transaction when `item.quantity < quantity` with `success: false`.
- [ ] `executeTrade` SELL: rejects transaction when `inventoryItemId` doesn't belong to the character.
- [ ] Trade Generation Mandate appears in Iron Laws output.
- [ ] `formatShopNode()` renders correct table of wares with buy prices.
- [ ] `pnpm test` passes.
- [ ] `pnpm tsc --noEmit` passes.

---

## 6. Slice 3 — VTT Trade UI: "The Market" Overlay

**Priority:** P1 — Enhances the trade experience after mechanics are solid.
**Philosophy:** Clear → Immersive → Interactive, in that order.

### 6.1. Component: `TradeWindow.tsx`

`components/trade/TradeWindow.tsx`

A full-screen overlay component that renders when a `generateMerchant` payload is available. The component:

1. **Overlays the VTT** with a semi-transparent dark backdrop (consistent with SpoilsOfWar and AscensionOverlay patterns).
2. **Split-panel layout:**
   - **Left panel — Merchant Inventory:** Lists all items the merchant has for sale with names, types, rarity badges, descriptions, and buy prices.
   - **Right panel — Player Inventory:** Lists the player's current inventory items with names, types, and computed sell prices (at the merchant's `sellModifier`).
3. **Header section:** Merchant name, archetype label, and a diegetic greeting in an atmospheric quote block.
4. **Gold display bar:** Shows current party gold prominently. Updates in real-time after each transaction.
5. **Buy button** on each merchant item: Triggers `executeTrade({ action: "buy", itemIndex, quantity: 1 })`.
6. **Sell button** on each player item: Triggers `executeTrade({ action: "sell", inventoryItemId, quantity: 1 })`.
7. **Insufficient gold visual feedback:** If the player can't afford an item, the buy button is disabled and the price is rendered in red.
8. **Transaction confirmation flash:** After a successful trade, a brief golden flash effect and a "+[gold]" or "-[gold]" animation appears near the gold bar.
9. **Dismiss button:** "Leave the Market" — closes the overlay and returns to the exploration view.

### 6.2. Visual Design Specification

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  ░░░░░░░░░░░░░░░░░░░░░ SEMI-TRANSPARENT OVERLAY ░░░░░░░░░░░░░░░░░░░░░░░░░ │
│  ░░  ┌──────────────────────────────────────────────────────────────┐  ░░  │
│  ░░  │                                                              │  ░░  │
│  ░░  │  🏪  Brynn Ashford — Blacksmith                              │  ░░  │
│  ░░  │  "Steel and sweat, friend. What do you need forged?"         │  ░░  │
│  ░░  │                                                              │  ░░  │
│  ░░  │  ┌── 💰 Party Gold: 342 GP ─────────────────────────────┐   │  ░░  │
│  ░░  │  └──────────────────────────────────────────────────────┘   │  ░░  │
│  ░░  │                                                              │  ░░  │
│  ░░  │  ┌─── MERCHANT WARES ────────┐  ┌─── YOUR INVENTORY ───┐   │  ░░  │
│  ░░  │  │                           │  │                       │   │  ░░  │
│  ░░  │  │  ⚔ Blade of Bitter Resolve│  │  ⚔ Rusty Short Sword │   │  ░░  │
│  ░░  │  │  weapon · RARE            │  │  weapon · mundane     │   │  ░░  │
│  ░░  │  │  A single-edged sword     │  │  Sell: 3 GP           │   │  ░░  │
│  ░░  │  │  whose blade darkens...   │  │  [SELL]               │   │  ░░  │
│  ░░  │  │  Buy: 550 GP              │  │                       │   │  ░░  │
│  ░░  │  │  [BUY]                    │  │  🧪 Healing Potion    │   │  ░░  │
│  ░░  │  │                           │  │  consumable · uncommon│   │  ░░  │
│  ░░  │  │  🛡 Iron Buckler         │  │  Sell: 25 GP          │   │  ░░  │
│  ░░  │  │  armor · uncommon         │  │  [SELL]               │   │  ░░  │
│  ░░  │  │  A dented shield with...  │  │                       │   │  ░░  │
│  ░░  │  │  Buy: 55 GP               │  │  📜 Voidclasp Ring   │   │  ░░  │
│  ░░  │  │  [BUY]                    │  │  misc · very_rare     │   │  ░░  │
│  ░░  │  │                           │  │  Sell: 600 GP         │   │  ░░  │
│  ░░  │  │  ...                      │  │  [SELL]               │   │  ░░  │
│  ░░  │  │                           │  │                       │   │  ░░  │
│  ░░  │  └───────────────────────────┘  └───────────────────────┘   │  ░░  │
│  ░░  │                                                              │  ░░  │
│  ░░  │          ┌──────────────────────────────┐                    │  ░░  │
│  ░░  │          │    🚪 Leave the Market       │                    │  ░░  │
│  ░░  │          └──────────────────────────────┘                    │  ░░  │
│  ░░  │                                                              │  ░░  │
│  ░░  └──────────────────────────────────────────────────────────────┘  ░░  │
│  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 6.3. Component Props

```typescript
interface TradeWindowProps {
  /** The merchant payload returned by the generateMerchant tool. */
  merchant: MerchantPayload;
  /** The player's current inventory items. */
  playerInventory: InventoryItem[];
  /** Current party gold balance. */
  gold: number;
  /** Callback when the player executes a buy action. */
  onBuy: (itemIndex: number, quantity: number) => Promise<TradeResult>;
  /** Callback when the player executes a sell action. */
  onSell: (inventoryItemId: string, quantity: number) => Promise<TradeResult>;
  /** Callback when the player dismisses the trade window. */
  onClose: () => void;
  /** Whether the overlay is visible. */
  isOpen: boolean;
}
```

### 6.4. CSS Requirements

- **Backdrop:** `position: fixed; inset: 0; background: rgba(10, 10, 14, 0.92); z-index: 1000;`
- **Trade panel:** `background: var(--color-surface-elevated);` with `border: 1px solid var(--color-amber-600);` — max-width `900px`, centered.
- **Split panels:** CSS Grid `grid-template-columns: 1fr 1fr;` with a `1px` divider between merchant wares and player inventory.
- **Merchant name:** `color: var(--color-amber-400); font-size: 1.5rem; font-weight: 700;`
- **Greeting:** `color: var(--color-text-muted); font-style: italic;`
- **Gold bar:** `background: linear-gradient(90deg, var(--color-amber-900), var(--color-amber-700));` with `color: var(--color-amber-200);`
- **Rarity colors** — reuse from SpoilsOfWar:
  - mundane: `hsl(0 0% 50%)`
  - uncommon: `hsl(145 40% 45%)`
  - rare: `hsl(215 60% 50%)`
  - very_rare: `hsl(270 50% 55%)`
  - legendary: `hsl(40 100% 55%)` with glow
- **Buy button:** Amber gradient, hover glow. Disabled state: grey with `cursor: not-allowed`.
- **Sell button:** Muted green gradient.
- **Unaffordable item price:** `color: var(--color-red-400);`
- **Transaction flash:** `@keyframes gold-flash` — brief golden pulse near the gold bar.
- **Responsive:** Stacks to single-column on screens < 768px.

### 6.5. Animation Specification

- **Overlay entrance:** fade-in over 400ms, `ease-out`.
- **Gold bar update:** count-up/count-down animation when gold changes, 600ms duration.
- **Transaction flash:** `+42 GP` or `-550 GP` floats up and fades out over 1200ms.
- **Item list shifts:** smooth height transition when items are added/removed, 300ms.
- **reduced-motion:** all animations disabled via `prefers-reduced-motion: reduce`.

### 6.6. Game Event Handler Integration

The `generateMerchant` tool response must be intercepted by the client-side game event handler:

```
// In the campaign page's message stream handler:
// When a tool_result contains a MerchantPayload (detected by checking
// for `npcSeed` + `archetype` + `inventory` + `buyModifier` fields):
//
// 1. Parse the payload against MerchantPayloadSchema.
// 2. Fetch the character's current inventory from DB.
// 3. Set React state: setMerchantPayload(payload).
// 4. Set isTradeOpen = true.
// 5. The TradeWindow renders.
//
// The onBuy callback should:
//   - Dispatch a user message: "I'd like to buy [item name]"
//   - OR directly call the executeTrade tool via the narrator pipeline.
//   - Update local gold + inventory state from the TradeResult.
//
// The onSell callback should:
//   - Dispatch a user message: "I'd like to sell [item name]"
//   - OR directly call the executeTrade tool.
//   - Update local gold + inventory state from the TradeResult.
//
// The onClose callback:
//   - Set isTradeOpen = false.
//   - Clear merchantPayload.
//   - Dispatch: "I leave the merchant's shop."
```

### 6.7. Accessibility Requirements

- **Focus trap** — keyboard focus is trapped within the overlay while it's open.
- **ARIA role** — `role="dialog"`, `aria-labelledby` pointing to the merchant name header, `aria-modal="true"`.
- **Screen reader** — merchant name and wares announced via `aria-live="polite"` on overlay open.
- **Keyboard** — `Escape` key dismisses the overlay (same as "Leave the Market").
- **Tab order** — Buy/Sell buttons follow a logical tab order: left panel items first, then right panel items, then dismiss button.
- **Contrast** — all prices and item names meet WCAG AA contrast minimums against the dark backdrop.
- **Disabled buttons** — `aria-disabled="true"` with descriptive `aria-label` ("Cannot afford — need 550 GP, you have 342 GP").

### 6.8. Slice 3 Task Breakdown

| Task | File | Type | Depends On |
|------|------|------|------------|
| 3.1 Create `TradeWindow.tsx` with props interface and overlay scaffold | `components/trade/TradeWindow.tsx` | Component | Slice 2 |
| 3.2 Implement split-panel layout — merchant wares (left) + player inventory (right) | `components/trade/TradeWindow.tsx` | CSS/JSX | 3.1 |
| 3.3 Implement merchant header section (name, archetype, greeting) | `components/trade/TradeWindow.tsx` | JSX | 3.1 |
| 3.4 Implement gold display bar with current balance | `components/trade/TradeWindow.tsx` | JSX | 3.1 |
| 3.5 Implement merchant item cards with rarity badges, descriptions, buy prices, buy buttons | `components/trade/TradeWindow.tsx` | JSX | 3.2 |
| 3.6 Implement player inventory cards with sell prices and sell buttons | `components/trade/TradeWindow.tsx` | JSX | 3.2 |
| 3.7 Implement buy button disabled state for unaffordable items | `components/trade/TradeWindow.tsx` | Logic | 3.5 |
| 3.8 Implement gold bar count animation and transaction flash effect | `components/trade/TradeWindow.tsx` | CSS/JS | 3.4 |
| 3.9 Implement `@keyframes gold-flash` and transaction ±GP float animation | CSS | Animation | 3.8 |
| 3.10 Implement "Leave the Market" dismiss button | `components/trade/TradeWindow.tsx` | JSX | 3.1 |
| 3.11 Add `MerchantPayload` detection in message stream handler | `app/campaign/[id]/page.tsx` | Logic | Slice 2 |
| 3.12 Wire `TradeWindow` state management (open/close, merchant payload, onBuy/onSell callbacks) | `app/campaign/[id]/page.tsx` | State | 3.1, 3.11 |
| 3.13 Implement focus trap + escape key handler | `components/trade/TradeWindow.tsx` | A11y | 3.10 |
| 3.14 Responsive layout — single-column stack on screens < 768px | `components/trade/TradeWindow.tsx` | CSS | 3.2 |
| 3.15 Write component tests for `TradeWindow` — renders merchant data, handles buy/sell, gold display | `tests/components/TradeWindow.test.tsx` | Tests | 3.1–3.10 |
| 3.16 Write component test: buy button disabled when gold insufficient | `tests/components/TradeWindow.test.tsx` | Test | 3.7 |
| 3.17 Accessibility audit: ARIA roles, focus management, keyboard nav, contrast | — | A11y | 3.13 |

### 6.9. Acceptance Criteria

- [ ] `TradeWindow` renders with all `MerchantPayload` fields displayed (name, archetype, greeting, inventory, prices).
- [ ] Merchant wares panel displays correct buy prices for each item.
- [ ] Player inventory panel displays correct sell prices (base value × merchant's sellModifier).
- [ ] Buy button is disabled and price turns red when `gold < buyPriceGP`.
- [ ] Buy button triggers `onBuy` callback and updates gold display + inventory.
- [ ] Sell button triggers `onSell` callback and updates gold display + inventory.
- [ ] Gold bar displays current balance and animates on change.
- [ ] Transaction flash animation shows `+GP` / `-GP` near the gold bar.
- [ ] "Leave the Market" button dismisses the overlay cleanly.
- [ ] Escape key also dismisses the overlay.
- [ ] Overlay backdrop covers the full viewport.
- [ ] Split-panel stacks to single column on narrow viewports (< 768px).
- [ ] Focus is trapped within the overlay while open.
- [ ] All interactive elements have descriptive `aria-label` attributes.
- [ ] All animations respect `prefers-reduced-motion`.
- [ ] `pnpm test` passes.
- [ ] `pnpm tsc --noEmit` passes.

---

## 7. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| AI narrator ignores Trade Mandate and invents prices | Medium | High | Strong Iron Law constraint; `executeTrade` validates all math server-side regardless of what AI says |
| Infinite gold exploit — buy/sell cycle yields profit | Low | Critical | **Economic invariant test:** `sellPrice < buyPrice` enforced for all items and archetypes. Math makes this impossible with standard modifiers. |
| Merchant inventory too sparse for some archetypes | Medium | Medium | Ensure ≥10 items per archetype pool in loot-tables.json; extend in Slice 2 if needed |
| Player sells equipped items accidentally | Low | Medium | `executeTrade` SELL should warn or reject items with `equippedSlot !== null` (guard in execute) |
| Same seed produces identical merchant each visit — feels stale | Medium | Low | Acceptable for immersion ("the blacksmith always has the same stock"). Future extension: add a "restock" timestamp salt |
| Sell price 0 for items without valueGP in properties | Medium | Low | `getItemBaseValue()` defaults to 0 → sell at 1 GP (mercy minimum). Document as expected behavior. |

---

## 8. Verification Plan

### Automated Tests

| Layer | What | Command |
|-------|------|---------|
| Unit | All Zod schemas in Slice 1 | `pnpm vitest run tests/rules/trade.test.ts` |
| Unit | All pure functions in Slice 2 (price formulas, inventory gen, payload builder) | `pnpm vitest run tests/rules/trade.test.ts` |
| Unit | Economic invariant across all archetypes × all loot-table items | `pnpm vitest run tests/rules/trade.test.ts` |
| Unit | Formatter tests for Trade Mandate and shop section | `pnpm vitest run tests/memory/formatter.test.ts` |
| Component | `TradeWindow` rendering + interaction tests | `pnpm vitest run tests/components/TradeWindow.test.tsx` |
| Type | Full project type-check | `pnpm tsc --noEmit` |
| Build | Production build | `pnpm build` |

### Manual Verification

| Check | Method |
|-------|--------|
| Merchant generation | Navigate to a shop node → verify `generateMerchant` is called → inspect `MerchantPayload` in console |
| Buy transaction | Buy an item → verify `Campaign.gold` decremented correctly in DB + `InventoryItem` created |
| Sell transaction | Sell an item → verify `Campaign.gold` incremented correctly in DB + `InventoryItem` removed/decremented |
| Failed buy (insufficient gold) | Attempt to buy expensive item with low gold → verify rejection + error message |
| Failed sell (item not owned) | Attempt to sell non-existent item → verify rejection |
| Trade Window overlay | Visual inspection: renders correctly, split-panel layout, animations work, dismisses cleanly |
| Archetype variety | Test all 5 archetypes → verify each stocks appropriate item types |
| Determinism | Open same merchant twice (same seed) → verify identical inventory |
| Accessibility | Keyboard-only: Tab through items, Escape to dismiss. Screen reader: items and prices announced. |

---

## 9. Dependencies Between Slices

```
Slice 1 (Data Layer)
    │
    ├──── Zod schemas + types ────► Slice 2 (Trade Engine)
    │                                    │
    │                                    ├──── buildMerchantPayload() ────► Slice 3 (Trade Window)
    │                                    │
    │                                    ├──── generateMerchant tool ─────► Slice 3 (GameEventHandler)
    │                                    │
    │                                    └──── executeTrade tool ─────────► Slice 3 (onBuy/onSell callbacks)
    │
    └──── ARCHETYPE_CONFIGS ────► Slice 2 (inventory generation + pricing)
```

**Execution order is strict:** Slice 1 → Slice 2 → Slice 3. No parallelization.

Each slice MUST pass:
  1. `pnpm tsc --noEmit` (type safety)
  2. `pnpm test` (full suite green)

before proceeding to the next slice.

---

## 10. Future Extensions (Not in Milestone M Scope)

| Track | Feature | Blocked By |
|-------|---------|------------|
| M-B | Merchant Restocking — inventory refreshes after long rests or time passage | M (baseline trade system) |
| M-C | Haggling System — CHA-based skill checks for price negotiation | M (baseline pricing) |
| M-D | Black Market — illegal goods with faction reputation consequences | M (fence archetype baseline) |
| M-E | Crafting Integration — sell crafted items, buy crafting materials | M + future crafting milestone |
| M-F | Economy Balancing — inflation tracking, dynamic pricing based on supply/demand | M (baseline economy math) |
| M-G | Quest Rewards via Merchants — completed quests unlock special merchant stock | M + existing quest system |

---

## 11. Glossary

| Term | Definition |
|------|-----------|
| **MerchantArchetype** | The specialisation category of a merchant: blacksmith, alchemist, general, fence, or arcanist |
| **MerchantPayload** | The structured JSON object returned by `generateMerchant`, containing the merchant's identity, inventory, and pricing modifiers |
| **TradeItem** | An item in a merchant's inventory, enriched with a computed `buyPriceGP` based on the archetype's markup |
| **TradeAction** | The structured input for `executeTrade`, specifying buy/sell action, item reference, and quantity |
| **TradeResult** | The structured response from `executeTrade`, confirming success/failure and the gold delta |
| **Buy Modifier** | A multiplier (≥ 1.0) applied to an item's base `valueGP` to compute the merchant's asking price |
| **Sell Modifier** | A multiplier (< 1.0) applied to an item's base `valueGP` to compute what the merchant pays the player |
| **Economic Invariant** | The guarantee that `sellPrice < buyPrice` for any item under any archetype, preventing infinite gold exploits |
| **Shop Node** | A `LocationNode` with `feature: "shop"` — the World Weaver's trigger point for merchant interactions |
| **Seed Determinism** | The same NPC seed always produces the same merchant identity and inventory — no randomness at call time |

---

## 12. Cross-References

- **Milestone J** — Combat engine: `resolveEncounterEnd()`, `computeConsequences()` — victory triggers loot which feeds inventory for selling
- **Milestone K-A** — Loot system: `Campaign.gold`, `InventoryItem`, `LootItem`, `loot-tables.json` — item pools reused for merchant stock
- **Milestone K-B** — World Weaver: `LocationNode.feature === "shop"`, `npcSeed` — the discovery trigger for merchants
- **Milestone L** — Character Progression: XP system feeds leveling which unlocks access to higher-tier merchants (future)
- **Milestone I** — NPC system: `generateNPC(seed, role)` — merchant identity reused from this generator
- **PROJECT_CONTEXT.md** — §4 (Code is Law), §5 (Test Coverage), §25 (Precedence Order)
