# Milestone K — Track B: "World Weaver" — Procedural Environment & Mapping Generation

> **Precedence:** This document is subordinate to `PROJECT_CONTEXT.md` §25 (Precedence Order) and explicit user instructions.
> **Status:** Approved for execution — slice by slice.
> **Prerequisite:** Milestone K, Track A (Spoils of War) — confirmed 100% closed and committed to git.

---

## 1. Objective

Implement a **Procedural Environment & Mapping Generation** system that activates when players **travel, explore, or rest**. The system:

1. Detects an **exploration trigger** when the player declares intent to travel to a new location, explore an area, enter a building, or descend deeper into a dungeon.
2. Forces the AI narrator to call a new `generateLocation` tool — the narrator **may NOT** hallucinate room layouts, NPC placements, or spatial geometry on its own.
3. Uses a **seeded procedural algorithm** inspired by [Watabou](https://watabou.github.io/) / Inkwell zone-adjacency principles to generate a graph of interconnected **Nodes** (rooms, zones, or areas) with assigned features and NPCs.
4. Persists all generated locations, nodes, and node features into **Prisma** models — not via narrative fiat.
5. Surfaces the generated map through a dedicated **"Exploration View"** VTT React component showing nodes, connections, and the player's current position so they can choose where to move next.

### Design Pillars (inherited from PROJECT_CONTEXT.md)

| Pillar | Application in Track B |
|---|---|
| **Code is Law** | Prisma handles all location state. The AI narrator may describe the atmosphere of a room, but it CANNOT invent rooms, connections, exits, or NPCs that don't exist in the database. The `generateLocation` tool is the single source of truth for spatial structure. |
| **Readability beats spectacle** | The Exploration View must clearly communicate room connections, player position, and available movement choices. Clarity of navigation > visual extravagance. |
| **Diegetic immersion** | Generated locations carry evocative names and brief environmental descriptions that reinforce the dark-fantasy world — "The Dripping Nave" not "Room 3". |
| **100% Test Coverage Requirement** | Every pure function must have comprehensive unit tests. Every Zod schema must have validation tests. No slice is complete until `pnpm test` passes with full coverage of the new code. |

---

## 2. Core Loop — Trigger → Generate → Persist → Navigate → Display

```
  Player declares: "I enter the crypt" / "We travel to the village" / "Let's explore this floor"
          │
          ▼
  AI Narrator receives system prompt:
    "EXPLORATION TRIGGER. You MUST call `generateLocation` now."
          │
          ▼
  AI calls tool: generateLocation({ campaignId, locationType, seed, parentLocationId? })
          │
          ▼
  ┌───────────────────────────────────────────────────────────────────┐
  │              lib/rules/exploration.ts (pure)                     │
  │                                                                   │
  │  1. seed → deterministic PRNG stream                             │
  │  2. locationType → template selection (tavern/village/dungeon/   │
  │     wilderness/ruins)                                            │
  │  3. generateNodeGraph(type, seed) →                              │
  │     a. Roll node count within type-specific bounds               │
  │     b. Place nodes using seeded spatial distribution              │
  │     c. Connect nodes via adjacency (minimum spanning tree +      │
  │        seeded bonus edges for loops/shortcuts)                   │
  │  4. assignNodeFeatures(nodes, type, seed) →                      │
  │     a. Each node gets a name, description, and feature tag       │
  │     b. Nodes may receive NPC assignments from the archetype pool │
  │     c. Nodes may receive hazard/loot/quest-hook markers          │
  │  5. Designate entry node (always node[0]) and optional exit(s)   │
  │  6. assembleLocationPayload() → LocationPayload                  │
  └─────────────────────────┬─────────────────────────────────────────┘
                            │
                            ▼
              ┌─────────────────────────────┐
              │    LocationPayload (JSON)    │
              │                             │
              │  name: string               │
              │  type: LocationType         │
              │  description: string        │
              │  nodes: NodePayload[]       │
              │  edges: EdgePayload[]       │
              │  entryNodeIndex: number     │
              │  seed: string               │
              └──────────┬──────────────────┘
                         │
                         ▼
              Prisma transaction:
                1. Create Location record
                2. Create LocationNode[] for each node
                3. Create LocationEdge[] for each connection
                4. Set Campaign.currentLocationId
                5. Set Campaign.currentNodeId = entryNode
                         │
                         ▼
              Tool returns LocationPayload to AI
                         │
                         ▼
              AI narrates arrival using the payload
              (MUST use node names + descriptions verbatim)
                         │
                         ▼
              UI: "Exploration View" renders the node graph
              Player clicks a connected node → AI narrates movement
```

---

## 3. Existing Infrastructure Audit

### What exists (Milestone K-A baseline)

| Module | State | Relevance to Track B |
|--------|-------|----------------------|
| `lib/rules/generators.ts` | `seededFloat()`, `pickSeeded()`, `cyrb53()` — deterministic PRNG | **Reuse** — all procedural generation uses this PRNG |
| `lib/rules/generators/topology.ts` | `generateDungeonGrid()` — cellular automata grid generation | **Foundation** — the low-level grid gen exists; Track B adds **graph-based zone abstraction** on top |
| `lib/rules/generators/names.ts` | `generateNPCName()` — syllabic name generation | **Reuse** — location/room names use the same syllabic system |
| `lib/rules/spatial.ts` | `Zone`, `GridZone`, `canMove()`, `calculateDistance()` | **Foundation** — the spatial graph type system exists for combat zones; Track B extends it for exploration |
| `lib/rules/npc.ts` | `generateNPC()` — full NPC statblock generation | **Integration** — nodes may have NPCs assigned from this generator |
| `lib/ai/narrator.ts` | `buildTools()` — tool registry for AI narrator | **Integration point** — new `generateLocation` + `moveToNode` tools go here |
| `lib/memory/formatter.ts` | `formatIronLaws()`, `formatSystemPrompt()` — narrator constraint system | **Update point** — add Exploration Generation Mandate |
| `prisma/schema.prisma` | `Campaign`, `NPC`, `Zone`, `Encounter` | **Update** — add `Location`, `LocationNode`, `LocationEdge` models + tracking columns on Campaign |
| `components/combat/ZoneGrid.tsx` | Zone-based grid renderer for combat | **Pattern reference** — the exploration map follows the same component architecture |

### What is missing

1. **Location persistence** — no `Location`, `LocationNode`, or `LocationEdge` models.
2. **Campaign location tracking** — no `currentLocationId` or `currentNodeId` on Campaign.
3. **Exploration generation engine** — no `lib/rules/exploration.ts` exists.
4. **`generateLocation` AI tool** — the narrator has no way to create structured environments.
5. **`moveToNode` AI tool** — the narrator has no way to move the player between nodes.
6. **Exploration Generation Mandate** in Iron Laws — the AI is not yet constrained to use the location tool.
7. **"Exploration View" UI** — no map component for rendering node graphs.
8. **Location type templates** — no data defining the structural rules for different location archetypes.

---

## 4. Slice 1 — Data Layer

**Priority:** P0 — Must be first. All other slices depend on this.
**Philosophy:** Schema first, types second, validation third. No business logic in this slice.

### 4.1. Prisma Schema Updates

#### New models:

```prisma
/// A procedurally generated location — a tavern, village, dungeon floor, etc.
/// Created exclusively by the `generateLocation` tool; the AI narrator may NOT
/// invent locations outside this table.
model Location {
  id          String  @id @default(cuid())
  campaignId  String
  /// Deterministic seed — the same seed always reproduces the same layout.
  seed        String
  /// Location archetype: "tavern" | "village" | "dungeon" | "wilderness" | "ruins"
  type        String
  /// Human-readable evocative name, e.g. "The Dripping Nave"
  name        String
  /// 1–3 sentence atmospheric description.
  description String
  /// Optional parent — e.g. a dungeon floor's parent is the dungeon entrance.
  parentId    String?
  createdAt   DateTime @default(now())

  campaign Campaign       @relation(fields: [campaignId], references: [id])
  parent   Location?      @relation("LocationHierarchy", fields: [parentId], references: [id])
  children Location[]     @relation("LocationHierarchy")
  nodes    LocationNode[]
  edges    LocationEdge[]

  @@index([campaignId])
  @@unique([campaignId, seed])
}

/// A single room, area, or zone within a Location.
/// Part of the node graph that players navigate.
model LocationNode {
  id          String  @id @default(cuid())
  locationId  String
  /// Index within the generated graph (0 = entry node).
  index       Int
  /// Evocative name, e.g. "The Whispering Gallery"
  name        String
  /// Brief atmospheric description (≤ 300 chars).
  description String
  /// Feature tag: "empty" | "npc" | "hazard" | "treasure" | "quest_hook" | "rest" | "shop" | "exit"
  feature     String  @default("empty")
  /// Optional NPC seed — links to NPC generation for this node's inhabitant.
  npcSeed     String?
  /// Optional extra feature data (hazard details, shop inventory hints, etc.)
  featureData Json    @default("{}")
  /// Grid position for visual rendering (column, 0-based).
  x           Int
  /// Grid position for visual rendering (row, 0-based).
  y           Int

  location    Location       @relation(fields: [locationId], references: [id], onDelete: Cascade)
  edgesFrom   LocationEdge[] @relation("EdgeFrom")
  edgesTo     LocationEdge[] @relation("EdgeTo")

  @@unique([locationId, index])
  @@index([locationId])
}

/// An edge connecting two LocationNodes — defines navigable passages.
/// Edges are bidirectional: if A→B exists, B→A is implicit.
model LocationEdge {
  id          String @id @default(cuid())
  locationId  String
  fromNodeId  String
  toNodeId    String
  /// Passage type: "open" | "door" | "locked" | "hidden" | "collapsed"
  passageType String @default("open")

  location Location     @relation(fields: [locationId], references: [id], onDelete: Cascade)
  fromNode LocationNode @relation("EdgeFrom", fields: [fromNodeId], references: [id], onDelete: Cascade)
  toNode   LocationNode @relation("EdgeTo", fields: [toNodeId], references: [id], onDelete: Cascade)

  @@unique([fromNodeId, toNodeId])
  @@index([locationId])
}
```

#### Campaign model additions:

```prisma
model Campaign {
  // ... existing fields ...

  /// The location the party is currently exploring. Null = no active exploration.
  currentLocationId  String?
  /// The specific node within the location the party occupies. Null = not in a location.
  currentNodeId      String?

  // ... existing relations ...
  locations  Location[]
}
```

**Migration name:** `add_exploration_models`

### 4.2. Location Type System

Define in `lib/rules/exploration.ts`:

```typescript
export const LOCATION_TYPES = [
  "tavern",
  "village",
  "dungeon",
  "wilderness",
  "ruins",
] as const;

export type LocationType = (typeof LOCATION_TYPES)[number];
```

### 4.3. Node Feature Tags

```typescript
export const NODE_FEATURES = [
  "empty",       // Atmospheric filler — description only
  "npc",         // An NPC inhabits or is stationed here
  "hazard",      // Environmental danger (trap, unstable floor, poison gas)
  "treasure",    // Lootable container or cache
  "quest_hook",  // Clue, notice board, or story beat
  "rest",        // Safe resting point (hearth, campsite, shrine)
  "shop",        // Merchant or vendor
  "exit",        // Passageway to another location or the overworld
] as const;

export type NodeFeature = (typeof NODE_FEATURES)[number];
```

### 4.4. Passage Type System

```typescript
export const PASSAGE_TYPES = [
  "open",       // Freely navigable
  "door",       // Closed but unlocked — costs no action
  "locked",     // Requires a key, lockpick check, or force
  "hidden",     // Not visible until discovered (Search/Perception check)
  "collapsed",  // Blocked — requires clearing or alternative route
] as const;

export type PassageType = (typeof PASSAGE_TYPES)[number];
```

### 4.5. Zod Schemas for Tool I/O

#### Input schema (for the `generateLocation` tool):

```typescript
export const GenerateLocationInputSchema = z.object({
  locationType: z
    .enum(LOCATION_TYPES)
    .describe(
      "The archetype of the location to generate. " +
      "Determines node count ranges, feature distribution, and naming flavor."
    ),
  seed: z
    .string()
    .min(1)
    .max(100)
    .optional()
    .describe(
      "Optional deterministic seed. If omitted, derived from campaignId + timestamp. " +
      "The same seed always produces the identical layout."
    ),
  parentLocationId: z
    .string()
    .optional()
    .describe(
      "If this location is nested (e.g., a dungeon floor below another), " +
      "provide the parent location's ID."
    ),
});

export type GenerateLocationInput = z.infer<typeof GenerateLocationInputSchema>;
```

#### Node payload:

```typescript
export const NodePayloadSchema = z.object({
  index: z.number().int().nonnegative(),
  name: z.string().min(1).max(100),
  description: z.string().min(1).max(300),
  feature: z.enum(NODE_FEATURES),
  npcSeed: z.string().nullable(),
  featureData: z.record(z.unknown()),
  x: z.number().int(),
  y: z.number().int(),
});

export type NodePayload = z.infer<typeof NodePayloadSchema>;
```

#### Edge payload:

```typescript
export const EdgePayloadSchema = z.object({
  fromIndex: z.number().int().nonnegative(),
  toIndex: z.number().int().nonnegative(),
  passageType: z.enum(PASSAGE_TYPES),
});

export type EdgePayload = z.infer<typeof EdgePayloadSchema>;
```

#### Complete location payload:

```typescript
export const LocationPayloadSchema = z.object({
  name: z.string().min(1).max(150),
  type: z.enum(LOCATION_TYPES),
  description: z.string().min(1).max(500),
  nodes: z.array(NodePayloadSchema).min(2),  // Minimum 2 nodes (entry + at least one room)
  edges: z.array(EdgePayloadSchema).min(1),  // Minimum 1 edge (entry connected to something)
  entryNodeIndex: z.number().int().nonnegative(),
  seed: z.string(),
});

export type LocationPayload = z.infer<typeof LocationPayloadSchema>;
```

#### Move input schema (for the `moveToNode` tool):

```typescript
export const MoveToNodeInputSchema = z.object({
  targetNodeIndex: z
    .number()
    .int()
    .nonnegative()
    .describe("The index of the node the player wants to move to. Must be adjacent to the current node."),
});

export type MoveToNodeInput = z.infer<typeof MoveToNodeInputSchema>;
```

### 4.6. Slice 1 Task Breakdown

| Task | File | Type | Depends On |
|------|------|------|------------|
| 1.1 Schema migration: add `Location`, `LocationNode`, `LocationEdge` models | `prisma/schema.prisma` | Migration | — |
| 1.2 Schema migration: add `currentLocationId`, `currentNodeId` to Campaign | `prisma/schema.prisma` | Migration | 1.1 |
| 1.3 Run `pnpm prisma generate` to regenerate client | — | Command | 1.1–1.2 |
| 1.4 Define `LocationType`, `NodeFeature`, `PassageType` type unions + const arrays | `lib/rules/exploration.ts` | Types | — |
| 1.5 Define `GenerateLocationInputSchema` (Zod) | `lib/rules/exploration.ts` | Schema | 1.4 |
| 1.6 Define `NodePayloadSchema` (Zod) | `lib/rules/exploration.ts` | Schema | 1.4 |
| 1.7 Define `EdgePayloadSchema` (Zod) | `lib/rules/exploration.ts` | Schema | 1.4 |
| 1.8 Define `LocationPayloadSchema` (Zod) | `lib/rules/exploration.ts` | Schema | 1.6, 1.7 |
| 1.9 Define `MoveToNodeInputSchema` (Zod) | `lib/rules/exploration.ts` | Schema | — |
| 1.10 Write unit tests for all Zod schemas (valid + invalid inputs, edge cases, boundary values) | `tests/rules/exploration.test.ts` | Tests | 1.4–1.9 |
| 1.11 Type-check: `pnpm tsc --noEmit` | — | Validation | 1.1–1.9 |

### 4.7. Acceptance Criteria

- [ ] `Location`, `LocationNode`, and `LocationEdge` tables exist in the database.
- [ ] `Campaign` has `currentLocationId` and `currentNodeId` nullable columns.
- [ ] `@@unique([campaignId, seed])` on Location prevents duplicate generation.
- [ ] `@@unique([locationId, index])` on LocationNode ensures node index uniqueness.
- [ ] `@@unique([fromNodeId, toNodeId])` on LocationEdge prevents duplicate edges.
- [ ] All Zod schemas parse valid inputs and reject malformed ones.
- [ ] Schema tests cover: empty node arrays, single-node locations (rejected — min 2), invalid feature tags, oversized descriptions, negative indices, missing required fields.
- [ ] `pnpm test` passes.
- [ ] `pnpm tsc --noEmit` passes.

---

## 5. Slice 2 — The Generation Engine

**Priority:** P0 — Must complete before UI integration.
**Philosophy:** Pure math first, tool integration second. Every function deterministic given a seed. Inspired by Watabou's zone-adjacency model and Inkwell graph-based dungeon generation.

### 5.1. Location Type Templates

Define in `lib/rules/exploration.ts` as a pure data constant:

```
LOCATION_TEMPLATES: Record<LocationType, LocationTemplate>

LocationTemplate = {
  nodeCountMin: number;      // Minimum rooms/areas
  nodeCountMax: number;      // Maximum rooms/areas
  featureDistribution: Record<NodeFeature, number>;  // Weights (0.0–1.0)
  nameAdjectives: string[];  // For location naming
  nameNouns: string[];       // For location naming
  nodeNamePool: string[];    // Pool of evocative room/area names
  descriptionPool: string[]; // Pool of atmospheric descriptions
  bonusEdgeChance: number;   // Probability of extra edges beyond MST (0.0–1.0)
}

Templates:
  tavern:
    nodes: 3–6
    features: { rest: 0.20, npc: 0.30, shop: 0.15, empty: 0.25, exit: 0.10 }
    bonusEdgeChance: 0.5  (taverns have open floor plans)

  village:
    nodes: 5–10
    features: { npc: 0.25, shop: 0.20, quest_hook: 0.10, rest: 0.10, empty: 0.25, exit: 0.10 }
    bonusEdgeChance: 0.4  (villages have multiple paths)

  dungeon:
    nodes: 6–12
    features: { hazard: 0.20, treasure: 0.15, empty: 0.30, npc: 0.10, exit: 0.10, quest_hook: 0.05, rest: 0.05, locked/hidden passages: 0.05 }
    bonusEdgeChance: 0.25 (dungeons are more linear with occasional loops)

  wilderness:
    nodes: 4–8
    features: { hazard: 0.15, empty: 0.35, npc: 0.10, rest: 0.15, quest_hook: 0.10, exit: 0.15 }
    bonusEdgeChance: 0.6  (open terrain has many paths)

  ruins:
    nodes: 5–10
    features: { hazard: 0.20, treasure: 0.20, empty: 0.25, quest_hook: 0.10, exit: 0.10, collapsed passages: 0.15 }
    bonusEdgeChance: 0.2  (ruins are fragmented — few connecting paths)
```

### 5.2. Node Graph Generation Algorithm

```
function generateNodeGraph(type: LocationType, seed: string): { nodes: NodePayload[], edges: EdgePayload[] }

  1. template = LOCATION_TEMPLATES[type]
  2. nodeCount = seededInt(seed + ":count", template.nodeCountMin, template.nodeCountMax)

  3. PLACE NODES — Seeded spatial distribution:
     For each i in [0..nodeCount):
       x = seededInt(seed + ":nx:" + i, 0, 5)   // Grid column (0–5)
       y = seededInt(seed + ":ny:" + i, 0, 5)    // Grid row (0–5)
       // Jitter to avoid overlaps: if (x, y) already occupied, shift by 1 in seeded direction
       name = pickSeeded(seed + ":nodeName:" + i, template.nodeNamePool)
       description = pickSeeded(seed + ":nodeDesc:" + i, template.descriptionPool)
       feature = rollFeature(seed + ":feat:" + i, template.featureDistribution)
       npcSeed = (feature === "npc" || feature === "shop")
                   ? seed + ":npc:" + i
                   : null

  4. CONNECT NODES — Minimum Spanning Tree + bonus edges:
     a. Compute pairwise Euclidean distance between all node (x, y) positions.
     b. Build MST using Prim's or Kruskal's algorithm (deterministic with sorted edges).
        → This guarantees every node is reachable (no orphans).
     c. For each non-MST edge, add it with probability = template.bonusEdgeChance
        using seededFloat(seed + ":edge:" + fromIndex + ":" + toIndex).
        → Creates loops and shortcuts without disconnecting the graph.
     d. Assign passageType per edge:
        - Default: "open"
        - In dungeons: seeded chance of "door" (30%), "locked" (10%), "hidden" (5%)
        - In ruins: seeded chance of "collapsed" (15%)

  5. DESIGNATE ENTRY:
     entryNodeIndex = 0  (always — first generated node is the entrance)

  6. DESIGNATE EXITS:
     Last node (nodeCount - 1) always has feature = "exit" (overriding rolled feature)

  Return { nodes, edges, entryNodeIndex: 0 }
```

### 5.3. Feature Assignment — Weighted Roll

```
function rollFeature(seed: string, distribution: Record<NodeFeature, number>): NodeFeature

  1. Roll seededFloat(seed) in [0, 1)
  2. Iterate distribution entries sorted by weight descending
  3. Accumulate weights; when cumulative weight exceeds the roll, return that feature
  4. Fallback: "empty"
```

This is a **pure function** — deterministic for any given seed.

### 5.4. Location Naming

```
function generateLocationName(type: LocationType, seed: string): string

  Reuse the same pattern as generateTavernName():
    adjective = pickSeeded(seed + ":locAdj", template.nameAdjectives)
    noun = pickSeeded(seed + ":locNoun", template.nameNouns)
    return "The " + adjective + " " + noun
```

Example outputs:
- tavern: "The Hollow Lantern"
- dungeon: "The Weeping Cistern"
- village: "The Sullen Crossing"
- wilderness: "The Bone Mire"
- ruins: "The Shattered Reliquary"

### 5.5. Node Naming — Evocative Room Names

Each location type has a curated pool of ≥20 evocative node names:

```
Dungeon nodes:
  "The Dripping Nave", "Chamber of Teeth", "The Sunken Altar",
  "The Warden's Post", "Corridor of Echoes", "The Ossuary",
  "The Collapsed Gallery", "Furnace Hall", "The Black Well",
  "The Wailing Cell", "The Rusted Gate", "Pillar Hall", ...

Tavern nodes:
  "The Common Room", "The Back Corner", "The Kitchen",
  "The Cellar", "The Stairwell", "The Private Booth", ...

Village nodes:
  "The Market Square", "The Blacksmith's Forge", "The Chapel",
  "The Well", "The Elder's House", "The Stables", ...

Wilderness nodes:
  "The Ridge", "The Hollow Oak", "The Stream Crossing",
  "The Cairn", "The Thornfield", "The Old Trail", ...

Ruins nodes:
  "The Broken Courtyard", "The Fallen Tower", "The Crypt Entrance",
  "The Overgrown Hall", "The Cracked Fountain", "The Sealed Door", ...
```

### 5.6. Orchestrator — `generateLocationPayload()`

```
function generateLocationPayload(input: {
  locationType: LocationType;
  seed: string;
}): LocationPayload

  1. name = generateLocationName(input.locationType, input.seed)
  2. description = pickSeeded(input.seed + ":desc", LOCATION_DESCRIPTIONS[input.locationType])
  3. { nodes, edges } = generateNodeGraph(input.locationType, input.seed)
  4. Validate: nodes.length ≥ 2, edges.length ≥ 1

  return { name, type: input.locationType, description, nodes, edges, entryNodeIndex: 0, seed: input.seed }
```

This function is **pure** — given the same inputs and seed, it always produces the same output.

### 5.7. Movement Validation — `canMoveToNode()`

```
function canMoveToNode(
  currentNodeIndex: number,
  targetNodeIndex: number,
  edges: EdgePayload[]
): boolean

  Return true if any edge connects currentNodeIndex ↔ targetNodeIndex
  (bidirectional — check both fromIndex→toIndex and toIndex→fromIndex).
  Also return true if currentNodeIndex === targetNodeIndex (staying put).
```

This reuses the same pattern as `canMove()` in `lib/rules/spatial.ts`.

### 5.8. Node Description Enrichment — `describeCurrentNode()`

```
function describeCurrentNode(
  node: NodePayload,
  adjacentNodes: NodePayload[],
  edges: EdgePayload[]   // edges connecting current node to adjacents
): string

  Returns a formatted description for the AI's system prompt:
    "## Current Location: [node.name]
     [node.description]

     **Feature:** [node.feature] — [feature-specific details]
     **Exits:** [list of adjacent node names with passage types]"
```

### 5.9. AI Tool Integration — `generateLocation`

Add to `buildTools()` in `lib/ai/narrator.ts`:

```typescript
generateLocation: tool({
  description:
    "Generate a new procedural location when the player travels, explores, " +
    "or enters a new area. Creates a persistent graph of interconnected rooms/zones " +
    "that the player navigates node-by-node. " +
    "MUST be called BEFORE narrating any new environment. " +
    "NEVER describe rooms, exits, NPCs, or spatial layout that isn't in the response. " +
    "The returned nodes define the ONLY rooms that exist. Code is Law.",
  inputSchema: GenerateLocationInputSchema,
  execute: async ({ locationType, seed, parentLocationId }) => {
    // 1. Derive seed if not provided: campaignId + Date.now()
    // 2. Guard: check if this seed already generated a location (idempotency)
    //    If exists, return the existing location instead of regenerating.
    // 3. Call generateLocationPayload({ locationType, seed })
    // 4. Validate payload against LocationPayloadSchema
    // 5. Prisma transaction:
    //    a. Create Location record
    //    b. Create LocationNode[] for each node
    //    c. Create LocationEdge[] for each edge (resolve node IDs from indices)
    //    d. Update Campaign.currentLocationId = location.id
    //    e. Update Campaign.currentNodeId = entryNode.id
    // 6. Return LocationPayload + locationId + entryNodeId
  },
})
```

### 5.10. AI Tool Integration — `moveToNode`

Add to `buildTools()` in `lib/ai/narrator.ts`:

```typescript
moveToNode: tool({
  description:
    "Move the player to an adjacent node within the current location. " +
    "The target node MUST be connected to the current node via an edge. " +
    "Call this when the player declares movement to a specific room or area. " +
    "After calling, narrate the movement and the destination using the returned node data. " +
    "NEVER describe a room the player hasn't moved to. Code is Law.",
  inputSchema: MoveToNodeInputSchema,
  execute: async ({ targetNodeIndex }) => {
    // 1. Fetch current location + nodes + edges from DB
    // 2. Resolve current node from Campaign.currentNodeId
    // 3. Validate movement: canMoveToNode(currentIndex, targetNodeIndex, edges)
    // 4. Check passageType — if "locked" or "hidden", return error (requires skill check first)
    // 5. Update Campaign.currentNodeId = targetNode.id
    // 6. Return target node data + adjacent node list + passage descriptions
  },
})
```

### 5.11. Formatter Update — Exploration Generation Mandate

Add to `formatIronLaws()` in `lib/memory/formatter.ts`:

```
"**Exploration Generation Mandate:** When the player declares intent to travel " +
"to a new location, explore an area, enter a building, or descend deeper, " +
"you MUST call `generateLocation` BEFORE narrating any environment. " +
"NEVER invent rooms, connections, exits, NPCs, or spatial structure. " +
"The tool response defines the ONLY rooms that exist in the location. " +
"Use node names and descriptions verbatim. " +
"When the player wants to move between rooms, call `moveToNode` — " +
"NEVER teleport the player to a non-adjacent node. " +
"Code is Law."
```

### 5.12. Formatter Addition — `formatExploration()`

Add a new section builder to `lib/memory/formatter.ts`:

```
function formatExploration(exploration: CampaignContext["currentExploration"]): string

  If no active exploration: return "## Exploration\nNo active location."

  Return:
    "## Current Exploration: [location.name] ([location.type])
     [location.description]

     ## Current Room: [currentNode.name]
     [currentNode.description]
     Feature: [currentNode.feature]
     NPC: [npcSeed or 'None']

     ## Available Exits:
     - [adjacentNode.name] — [passageType] ([direction hint])
     - [adjacentNode.name] — [passageType] ([direction hint])
     ...

     ## Visited Rooms: [list of visited node names]"
```

This section is injected into `formatSystemPrompt()` between the character state and combat sections.

### 5.13. Context Update — `CampaignContext`

Extend `CampaignContext` in `lib/memory/context.ts`:

```typescript
currentExploration: {
  location: { id: string; name: string; type: string; description: string } | null;
  currentNode: NodePayload | null;
  adjacentNodes: Array<{ node: NodePayload; passageType: string }>;
  visitedNodeIndices: number[];
  allNodes: NodePayload[];
  allEdges: EdgePayload[];
} | null;
```

Update `buildCampaignContext()` to fetch the active location, current node, and adjacent nodes from the database when `Campaign.currentLocationId` is set.

### 5.14. Slice 2 Task Breakdown

| Task | File | Type | Depends On |
|------|------|------|------------|
| 2.1 Define `LOCATION_TEMPLATES` data constant | `lib/rules/exploration.ts` | Data | Slice 1 types |
| 2.2 Implement `rollFeature()` — weighted random feature assignment | `lib/rules/exploration.ts` | Pure fn | — |
| 2.3 Implement `generateLocationName()` | `lib/rules/exploration.ts` | Pure fn | 2.1 |
| 2.4 Create node name pools + description pools per location type | `lib/rules/exploration.ts` | Data | — |
| 2.5 Implement `generateNodeGraph()` — MST + bonus edges | `lib/rules/exploration.ts` | Pure fn | 2.1, 2.2, 2.4 |
| 2.6 Implement passage type assignment within `generateNodeGraph()` | `lib/rules/exploration.ts` | Pure fn | 2.5 |
| 2.7 Implement `generateLocationPayload()` orchestrator | `lib/rules/exploration.ts` | Pure fn | 2.3, 2.5 |
| 2.8 Implement `canMoveToNode()` | `lib/rules/exploration.ts` | Pure fn | — |
| 2.9 Implement `describeCurrentNode()` | `lib/rules/exploration.ts` | Pure fn | — |
| 2.10 Write comprehensive unit tests for ALL pure functions | `tests/rules/exploration.test.ts` | Tests | 2.1–2.9 |
| 2.11 Unit test: graph connectivity — every generated graph must be fully connected (no orphan nodes) | `tests/rules/exploration.test.ts` | Test | 2.5 |
| 2.12 Unit test: determinism — same seed always produces identical output | `tests/rules/exploration.test.ts` | Test | 2.7 |
| 2.13 Unit test: boundary node counts — min/max for each location type | `tests/rules/exploration.test.ts` | Test | 2.7 |
| 2.14 Add `generateLocation` tool to `buildTools()` in narrator | `lib/ai/narrator.ts` | Tool | 2.7, Slice 1 |
| 2.15 Implement `generateLocation` tool execute function (generate → persist → return) | `lib/ai/narrator.ts` | Async | 2.14 |
| 2.16 Add `moveToNode` tool to `buildTools()` in narrator | `lib/ai/narrator.ts` | Tool | 2.8 |
| 2.17 Implement `moveToNode` tool execute function (validate → persist → return) | `lib/ai/narrator.ts` | Async | 2.16 |
| 2.18 Add Exploration Generation Mandate to `formatIronLaws()` | `lib/memory/formatter.ts` | Pure fn | — |
| 2.19 Implement `formatExploration()` section builder | `lib/memory/formatter.ts` | Pure fn | — |
| 2.20 Update `formatSystemPrompt()` to include exploration section | `lib/memory/formatter.ts` | Pure fn | 2.19 |
| 2.21 Update `CampaignContext` type + `buildCampaignContext()` to fetch exploration state | `lib/memory/context.ts` | Async | Slice 1 schema |
| 2.22 Integration test: generateLocation → verify DB records match payload | `tests/integration/exploration.test.ts` | Test | 2.14–2.17 |
| 2.23 Integration test: moveToNode → verify Campaign.currentNodeId updates | `tests/integration/exploration.test.ts` | Test | 2.16–2.17 |

### 5.15. Acceptance Criteria

- [ ] `generateLocationPayload()` produces a valid `LocationPayload` for every location type.
- [ ] Every generated graph is **fully connected** — no orphan nodes (MST guarantee).
- [ ] Same seed + type always produces the **identical** node graph (determinism).
- [ ] Node count falls within type-specific `[min, max]` bounds for every type.
- [ ] `canMoveToNode()` returns `true` only for adjacent nodes and self.
- [ ] `canMoveToNode()` returns `false` for non-adjacent nodes.
- [ ] Entry node (index 0) is always designated.
- [ ] Last node always has `feature = "exit"`.
- [ ] `generateLocation` tool creates `Location`, `LocationNode[]`, and `LocationEdge[]` records in the database.
- [ ] `Campaign.currentLocationId` and `Campaign.currentNodeId` are updated correctly.
- [ ] `moveToNode` tool updates `Campaign.currentNodeId` on valid moves.
- [ ] `moveToNode` tool returns error on invalid moves (non-adjacent).
- [ ] The formatter Exploration Generation Mandate appears in Iron Laws.
- [ ] `formatExploration()` correctly renders current node + exits for the AI prompt.
- [ ] `pnpm test` passes.
- [ ] `pnpm tsc --noEmit` passes.

---

## 6. Slice 3 — VTT Exploration UI: "Exploration View"

**Priority:** P1 — Enhances the exploration experience after mechanics are solid.
**Philosophy:** Clear → Atmospheric → Interactive, in that order.

### 6.1. Component: `ExplorationMap.tsx`

`components/exploration/ExplorationMap.tsx`

A React component that renders the generated node graph as an interactive map. The component:

1. **Renders nodes** as styled circles/rectangles positioned on a grid based on their `(x, y)` coordinates.
2. **Renders edges** as connecting lines/paths between related nodes, styled by `passageType`:
   - `open` — solid line
   - `door` — solid line with a small rectangle icon
   - `locked` — dashed line with a lock icon
   - `hidden` — dotted faint line (or invisible until discovered)
   - `collapsed` — jagged / broken line
3. **Highlights the current node** with a pulsing border and a distinct background color.
4. **Dims unvisited nodes** — visited nodes are fully revealed; unvisited but adjacent nodes show names but dimmed descriptions; non-adjacent unvisited nodes show as fog-of-war silhouettes.
5. **Makes adjacent nodes clickable** — clicking an adjacent node triggers the `moveToNode` tool via the narrator pipeline.
6. **Shows feature icons** on nodes:
   - `npc` — person silhouette ◆
   - `hazard` — warning triangle ⚠
   - `treasure` — chest icon 🗃
   - `quest_hook` — scroll icon 📜
   - `rest` — campfire icon 🔥
   - `shop` — coin icon 💰
   - `exit` — door/arrow icon 🚪
   - `empty` — no icon

### 6.2. Visual Design Specification

```
┌──────────────────────────────────────────────────────────────────┐
│                                                                  │
│  🗺 THE WEEPING CISTERN  (dungeon)                              │
│  ─────────────────────────────────                               │
│                                                                  │
│      ┌─────────┐          ┌─────────┐         ┌─────────┐      │
│      │ ⚠ The   │──────────│ ★ You   │─ ─ ─ ─ ─│ 🗃 The  │      │
│      │ Dripping│   open   │ Are Here│  locked  │ Sunken  │      │
│      │ Nave    │          │ (Entry) │          │ Altar   │      │
│      └────┬────┘          └────┬────┘         └─────────┘      │
│           │                    │                                 │
│           │ door               │ open                            │
│           │                    │                                 │
│      ┌────┴────┐          ┌────┴────┐                           │
│      │ ░░░░░░░ │          │ ◆ The   │                           │
│      │ ░ FOG ░ │          │ Warden's│                           │
│      │ ░░░░░░░ │          │ Post    │                           │
│      └─────────┘          └────┬────┘                           │
│                                │                                 │
│                                │ open                            │
│                                │                                 │
│                           ┌────┴────┐                           │
│                           │ 🚪 Exit │                           │
│                           │         │                           │
│                           └─────────┘                           │
│                                                                  │
│  Current: The Entry Hall │ Feature: empty │ Exits: 3            │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### 6.3. CSS Styling

The Exploration View uses the existing dark-fantasy palette from `app/globals.css`:

- **Background:** `rgba(10, 10, 14, 0.95)` — near-black with parchment texture overlay.
- **Node (visited):** `hsl(40 15% 15%)` background, `hsl(40 30% 55%)` border — warm dark parchment.
- **Node (current):** `hsl(40 40% 25%)` background, `hsl(40 100% 55%)` pulsing border — golden highlight.
- **Node (adjacent, unvisited):** `hsl(220 10% 20%)` background, `hsl(220 20% 40%)` border — mysterious blue-grey.
- **Node (fog-of-war):** `hsl(0 0% 12%)` background, `hsl(0 0% 20%)` border — near-invisible.
- **Edge (open):** `hsl(40 15% 40%)` solid 2px line.
- **Edge (door):** `hsl(40 15% 40%)` solid 2px line with a 6px rectangle icon at midpoint.
- **Edge (locked):** `hsl(0 40% 45%)` dashed 2px line with lock icon — red-tinted.
- **Edge (hidden):** `hsl(270 20% 30%)` dotted 1px line — nearly invisible (purple-tinted).
- **Edge (collapsed):** `hsl(0 0% 30%)` jagged/broken polyline.
- **Node text:** `hsl(40 15% 80%)` — warm parchment white.
- **Feature icons:** Colored by feature type with subtle drop shadow.

### 6.4. Animation Specification

- **Current node:** pulsing golden border via `@keyframes pulse-gold` — 2s infinite ease-in-out.
- **Node hover (adjacent):** scale to 1.05 + lighten border over 200ms.
- **Movement transition:** when the player moves, the old node dims and the new node brightens with a 400ms crossfade.
- **Fog reveal:** when a node is first visited, it "unveils" from fog-of-war with a 300ms fade-in + blur-to-clear.
- **Node click ripple:** 200ms radial pulse from center on click.
- **reduced-motion:** all animations disabled via `prefers-reduced-motion: reduce`.

### 6.5. Component: `NodeDetail.tsx`

`components/exploration/NodeDetail.tsx`

A sidebar or bottom panel that shows detailed information about the currently occupied node:

1. **Node name** (bold, large).
2. **Node description** (atmospheric italic text).
3. **Feature details** — NPC name/role if present, hazard description, loot hints, etc.
4. **Adjacent exits** — list of connected node names with passage type indicators.
5. **"Move To" buttons** — one per adjacent node, triggering `moveToNode`.

### 6.6. Integration with Main Game View

The `ExplorationMap` + `NodeDetail` components mount conditionally in the main game layout when `Campaign.currentLocationId` is set:

```
{currentExploration && (
  <ExplorationMap
    location={currentExploration.location}
    nodes={currentExploration.allNodes}
    edges={currentExploration.allEdges}
    currentNodeIndex={currentExploration.currentNode?.index ?? 0}
    visitedNodeIndices={currentExploration.visitedNodeIndices}
    onMoveToNode={(index) => handleMoveToNode(index)}
  />
)}
```

The component coexists with the narrative panel — the narrative text stream continues while the map is visible, so the player can read AI descriptions while seeing their spatial context.

### 6.7. State Management

- **Visited nodes** are tracked client-side as the player moves (also persisted server-side for session recovery).
- **Fog of war** is derived from `visitedNodeIndices` — only visited nodes and their immediate neighbors are revealed.
- **Player position** updates reactively when `moveToNode` tool response is received via the `GameEventHandler`.

### 6.8. Accessibility Requirements

- **Keyboard navigation** — arrow keys or Tab cycle through adjacent nodes; Enter triggers movement.
- **ARIA labels** — each node has `role="button"`, `aria-label="Move to [node name], [feature], [passage type]"`.
- **Screen reader** — current location summary announced via `aria-live="polite"` on node change.
- **Focus indicator** — visible focus ring on all interactive nodes (not just hover).
- **Contrast** — all node text and edge lines meet WCAG AA minimums.
- **Touch targets** — nodes are at least 44×44px for mobile accessibility.

### 6.9. Slice 3 Task Breakdown

| Task | File | Type | Depends On |
|------|------|------|------------|
| 3.1 Create `ExplorationMap.tsx` — SVG/Canvas-based node graph renderer | `components/exploration/ExplorationMap.tsx` | React | Slice 2 types |
| 3.2 Implement node rendering — positioned circles with feature icons | `components/exploration/ExplorationMap.tsx` | React | 3.1 |
| 3.3 Implement edge rendering — lines styled by passage type | `components/exploration/ExplorationMap.tsx` | React | 3.1 |
| 3.4 Implement fog-of-war — dim/hide unvisited non-adjacent nodes | `components/exploration/ExplorationMap.tsx` | React | 3.1 |
| 3.5 Implement current node highlighting + pulse animation | CSS | CSS | 3.1 |
| 3.6 Implement adjacent node click → `moveToNode` trigger | `components/exploration/ExplorationMap.tsx` | React | 3.1 |
| 3.7 Create `NodeDetail.tsx` — node detail sidebar/panel | `components/exploration/NodeDetail.tsx` | React | Slice 2 types |
| 3.8 Add CSS for Exploration View — dark-fantasy palette, fog-of-war, animations | `app/globals.css` or CSS module | CSS | — |
| 3.9 Integrate `ExplorationMap` + `NodeDetail` into main game layout | Main layout file | React | 3.1, 3.7 |
| 3.10 Update `GameEventHandler.tsx` to capture `generateLocation` and `moveToNode` tool responses | `components/combat/GameEventHandler.tsx` | React | Slice 2 |
| 3.11 Implement visited-node tracking (client-side state + server-side persistence) | `components/exploration/ExplorationMap.tsx` | React | 3.4 |
| 3.12 Accessibility pass — keyboard nav, ARIA roles, focus management, reduced-motion | `components/exploration/ExplorationMap.tsx` | A11Y | 3.1 |
| 3.13 Manual UI smoke test — generate a location, navigate between nodes, verify fog-of-war reveals | — | Manual | 3.1–3.12 |

### 6.10. Acceptance Criteria

- [ ] The Exploration Map renders correctly when `generateLocation` returns a valid `LocationPayload`.
- [ ] Nodes are positioned on the grid based on their `(x, y)` coordinates.
- [ ] Edges display correctly with appropriate passage type styling.
- [ ] The current node is highlighted with a pulsing golden border.
- [ ] Fog-of-war hides nodes that are neither visited nor adjacent to the current node.
- [ ] Clicking an adjacent node triggers movement and updates the current node.
- [ ] Feature icons display correctly on each node.
- [ ] The `NodeDetail` panel shows accurate information for the current node.
- [ ] All animations respect `prefers-reduced-motion`.
- [ ] Keyboard navigation works (Tab through nodes, Enter to move).
- [ ] `pnpm build` succeeds without errors.

---

## 7. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| AI narrator ignores `generateLocation` mandate and invents rooms | Medium | High | Strong Iron Law constraint; `moveToNode` tool rejects movement to non-existent nodes |
| Generated graphs have disconnected subgraphs (orphan nodes) | Low | Critical | MST algorithm **guarantees** full connectivity; unit test enforces this for every generated graph |
| Node (x, y) positions overlap, causing unreadable map | Medium | Medium | Jitter algorithm in node placement; minimum spacing enforcement; fallback grid layout |
| Too many nodes in a dungeon → visual clutter | Low | Medium | `nodeCountMax` capped at 12; template tuning per location type |
| `moveToNode` race condition — player clicks two nodes rapidly | Low | Low | Optimistic locking on `Campaign.currentNodeId`; disable buttons during transition |
| Passage type "locked" blocks exploration with no way to unlock | Medium | Medium | Initial scope: "locked" passages return an error message hinting at required skill check; future: integrate with dice system |
| Fog-of-war reveals too much or too little | Low | Medium | Fog rule is simple: visited + neighbors visible; adjustable in future |
| Location seed collision — same seed generates different content if template changes | Low | High | `@@unique([campaignId, seed])` prevents re-generation; breaking template changes require migration |

---

## 8. Verification Plan

### Automated Tests

| Layer | What | Command |
|-------|------|---------|
| Unit | All Zod schemas in Slice 1 | `pnpm vitest run tests/rules/exploration.test.ts` |
| Unit | All pure functions: `rollFeature`, `generateNodeGraph`, `canMoveToNode`, `generateLocationPayload` | `pnpm vitest run tests/rules/exploration.test.ts` |
| Unit | Graph connectivity invariant — every generated graph is fully connected | `pnpm vitest run tests/rules/exploration.test.ts` |
| Unit | Determinism invariant — same seed same output (100 iterations) | `pnpm vitest run tests/rules/exploration.test.ts` |
| Type | Full project type-check | `pnpm tsc --noEmit` |
| Integration | `generateLocation` tool cycle: trigger → tool → DB records | `pnpm vitest run tests/integration/exploration.test.ts` |
| Integration | `moveToNode` tool cycle: move → Campaign.currentNodeId update | `pnpm vitest run tests/integration/exploration.test.ts` |
| Build | Production build | `pnpm build` |

### Manual Verification

| Check | Method |
|-------|--------|
| Location generation correctness | Narrate "I enter the dungeon" → verify `generateLocation` is called → inspect `LocationPayload` in console |
| Node persistence | Check `LocationNode` records in database — names, features, positions match payload |
| Edge persistence | Check `LocationEdge` records — from/to nodes match, passage types correct |
| Movement validity | Attempt to move to adjacent node → verify success; attempt non-adjacent → verify rejection |
| Exploration Map rendering | Visual inspection: nodes positioned correctly, edges styled by type, current node highlighted |
| Fog of war | Navigate through nodes → verify only visited + adjacent nodes are revealed |
| Feature icons | Verify correct icons on NPC/hazard/treasure/exit nodes |
| Accessibility | Keyboard-only: Tab through nodes, Enter to move. Screen reader: node descriptions announced. |

---

## 9. Dependencies Between Slices

```
Slice 1 (Data Layer)
    │
    ├──── Zod schemas + types ────► Slice 2 (Generation Engine)
    │                                    │
    │                                    ├──── generateLocationPayload() ──► Slice 3 (Exploration Map UI)
    │                                    │
    │                                    ├──── generateLocation tool ───────► Slice 3 (GameEventHandler)
    │                                    │
    │                                    └──── moveToNode tool ────────────► Slice 3 (GameEventHandler)
    │
    └──── Location/Node schema ──────► Slice 2 (tool execute — DB writes)
```

**Execution order is strict:** Slice 1 → Slice 2 → Slice 3. No parallelization.

---

## 10. Future Extensions (Not in Track B Scope)

| Track | Feature | Blocked By |
|-------|---------|------------|
| K-B2 | Dynamic Events — random encounters while exploring | Track B (location/node baseline) |
| K-B3 | Dungeon Multi-Floor — nested locations with staircase connections | Track B (parentId hierarchy) |
| K-C | Shop & Trade System — spend gold at NPC merchant nodes | Track A (gold) + Track B (shop nodes) |
| K-D | Trap Resolution — rolling dice against hazard nodes | Track B (hazard feature) + future dice integration |
| K-E | Procedural NPC Dialogue — NPC nodes trigger conversation trees | Track B (npc nodes) + future dialogue system |
| K-F | World Map — overworld graph connecting multiple locations | Track B (location baseline) — macro scale |
| K-G | Rest Mechanics — long/short rest at "rest" nodes | Track B (rest feature) + future rest system |

---

## 11. Glossary

| Term | Definition |
|------|-----------|
| **LocationPayload** | The structured JSON object returned by `generateLocation`, containing name, type, nodes, edges, and entry point |
| **LocationNode** | A single room, area, or zone within a generated location — the fundamental navigable unit |
| **LocationEdge** | A connection between two nodes defining a navigable passage with a type (open/door/locked/hidden/collapsed) |
| **Node Feature** | A tag assigned to a node describing its primary content: npc, hazard, treasure, quest_hook, rest, shop, exit, or empty |
| **Passage Type** | The traversability of an edge: open (free), door (cosmetic), locked (requires check), hidden (requires discovery), collapsed (blocked) |
| **MST (Minimum Spanning Tree)** | A graph algorithm guaranteeing all nodes are reachable via the minimum number of edges — ensures no orphan rooms |
| **Fog of War** | UI rendering mode where unvisited, non-adjacent nodes are hidden or dimmed to create exploration mystery |
| **Location Type** | One of five archetypes (tavern, village, dungeon, wilderness, ruins) that determines generation templates |
| **Entry Node** | The first node (index 0) where the player begins exploration — always designated as the entrance |
| **Watabou Model** | An inspiration for zone-adjacency graph generation popularized by [watabou.github.io](https://watabou.github.io/) — nodes represent abstract areas connected by edges rather than pixel-precise maps |
