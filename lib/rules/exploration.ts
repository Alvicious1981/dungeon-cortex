import { z } from "zod";
import { seededFloat, pickSeeded } from "@/lib/rules/generators";
import { rollDie } from "@/lib/rules/dice";

// ---------------------------------------------------------------------------
// Location type system
// ---------------------------------------------------------------------------

export const LOCATION_TYPES = [
  "tavern",
  "village",
  "dungeon",
  "wilderness",
  "ruins",
] as const;

export type LocationType = (typeof LOCATION_TYPES)[number];

// ---------------------------------------------------------------------------
// Node feature tags
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Passage type system
// ---------------------------------------------------------------------------

export const PASSAGE_TYPES = [
  "open",       // Freely navigable
  "door",       // Closed but unlocked — costs no action
  "locked",     // Requires a key, lockpick check, or force
  "hidden",     // Not visible until discovered (Search/Perception check)
  "collapsed",  // Blocked — requires clearing or alternative route
] as const;

export type PassageType = (typeof PASSAGE_TYPES)[number];

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

/** Input schema for the `generateLocation` AI tool. */
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

/** A single node (room/area) within a generated location. */
export const NodePayloadSchema = z.object({
  index: z.number().int().nonnegative(),
  name: z.string().min(1).max(100),
  description: z.string().min(1).max(300),
  feature: z.enum(NODE_FEATURES),
  npcSeed: z.string().nullable(),
  featureData: z.record(z.string(), z.unknown()),
  x: z.number().int(),
  y: z.number().int(),
});

export type NodePayload = z.infer<typeof NodePayloadSchema>;

/** A directed edge connecting two nodes by their indices. */
export const EdgePayloadSchema = z.object({
  fromIndex: z.number().int().nonnegative(),
  toIndex: z.number().int().nonnegative(),
  passageType: z.enum(PASSAGE_TYPES),
});

export type EdgePayload = z.infer<typeof EdgePayloadSchema>;

/** The full structured output of the generateLocation tool. */
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

/** Input schema for the `moveToNode` AI tool. */
export const MoveToNodeInputSchema = z.object({
  targetNodeIndex: z
    .number()
    .int()
    .nonnegative()
    .describe("The index of the node the player wants to move to. Must be adjacent to the current node."),
});

export type MoveToNodeInput = z.infer<typeof MoveToNodeInputSchema>;

// ---------------------------------------------------------------------------
// Location templates
// ---------------------------------------------------------------------------

export interface LocationTemplate {
  nodeCountMin: number;
  nodeCountMax: number;
  /** Weights 0.0–1.0; remainder falls through to "empty". */
  featureDistribution: Partial<Record<NodeFeature, number>>;
  nameAdjectives: string[];
  nameNouns: string[];
  nodeNamePool: string[];
  descriptionPool: string[];
  bonusEdgeChance: number;
}

export const LOCATION_TEMPLATES: Record<LocationType, LocationTemplate> = {
  tavern: {
    nodeCountMin: 3,
    nodeCountMax: 6,
    featureDistribution: {
      rest: 0.20,
      npc: 0.30,
      shop: 0.15,
      empty: 0.25,
      exit: 0.10,
    },
    nameAdjectives: [
      "Hollow", "Gilded", "Rusty", "Blind", "Wandering",
      "Forsaken", "Broken", "Howling", "Crimson", "Iron",
    ],
    nameNouns: [
      "Flagon", "Lantern", "Boar", "Crow", "Cauldron",
      "Specter", "Dagger", "Pilgrim", "Anvil", "Gallows",
    ],
    nodeNamePool: [
      "The Common Room", "The Back Corner", "The Kitchen",
      "The Cellar", "The Stairwell", "The Private Booth",
      "The Hearth Corner", "The Barkeep's Counter", "The Side Room",
      "The Storeroom", "The Upstairs Landing", "The Smoking Room",
      "The Booth by the Fire", "The Backroom", "The Gambling Table",
      "The Stage Corner", "The Larder", "The Taproom",
      "The Stable Entry", "The Proprietor's Office",
    ],
    descriptionPool: [
      "Pipe smoke and ale-sour air. The fire cracks steadily.",
      "The floorboards groan underfoot. It is warm, at least.",
      "Low voices and the scrape of wooden cups.",
      "Grease and candlewax. The serving girl does not look up.",
      "A hearth dominates the room. The heat is almost aggressive.",
      "The place smells of old wood and cheap fat.",
    ],
    bonusEdgeChance: 0.5,
  },

  village: {
    nodeCountMin: 5,
    nodeCountMax: 10,
    featureDistribution: {
      npc: 0.25,
      shop: 0.20,
      quest_hook: 0.10,
      rest: 0.10,
      empty: 0.25,
      exit: 0.10,
    },
    nameAdjectives: [
      "Sullen", "Muddy", "Greying", "Broken", "Distant",
      "Hollow", "Fading", "Cold", "Forgotten", "Old",
    ],
    nameNouns: [
      "Crossing", "Ford", "Mill", "Hollow", "Common",
      "Market", "Gate", "Ridge", "Vale", "Heath",
    ],
    nodeNamePool: [
      "The Market Square", "The Blacksmith's Forge", "The Chapel",
      "The Well", "The Elder's House", "The Stables",
      "The Alehouse", "The Cobbler's Shop", "The Mill",
      "The Fishmonger's Stall", "The Apothecary", "The Guard Post",
      "The Docks", "The Town Square", "The Baker's Oven",
      "The Carpenter's Yard", "The Graveyard", "The Shrine",
      "The Herbalist", "The Tannery", "The Magistrate's Hall",
    ],
    descriptionPool: [
      "Mud street, thatched roofs, the smell of animals and bread.",
      "Children stop to stare. The adults pretend not to.",
      "A dog barks once and falls silent.",
      "The village sits quietly beneath a grey sky.",
      "Smoke from a dozen chimneys. Life lived in routine.",
    ],
    bonusEdgeChance: 0.4,
  },

  dungeon: {
    nodeCountMin: 6,
    nodeCountMax: 12,
    featureDistribution: {
      hazard: 0.20,
      treasure: 0.15,
      empty: 0.30,
      npc: 0.10,
      exit: 0.10,
      quest_hook: 0.05,
      rest: 0.05,
    },
    nameAdjectives: [
      "Weeping", "Black", "Sunken", "Dripping", "Silent",
      "Rotting", "Forgotten", "Shattered", "Howling", "Ashen",
    ],
    nameNouns: [
      "Cistern", "Crypt", "Nave", "Vault", "Pit",
      "Catacomb", "Chamber", "Ossuary", "Keep", "Shrine",
    ],
    nodeNamePool: [
      "The Dripping Nave", "Chamber of Teeth", "The Sunken Altar",
      "The Warden's Post", "Corridor of Echoes", "The Ossuary",
      "The Collapsed Gallery", "Furnace Hall", "The Black Well",
      "The Wailing Cell", "The Rusted Gate", "Pillar Hall",
      "The Flooded Passage", "The Bone Chapel", "The Iron Door",
      "The Throne of Stone", "The Guard Room", "The Torture Chamber",
      "The Armory", "The Hidden Vault", "The Sarcophagus Chamber",
    ],
    descriptionPool: [
      "The air is wet and cold. Fungal growths press through the mortar.",
      "Torchlight dies before it reaches the far wall.",
      "Something drips. Nothing else moves.",
      "The floor is slick with centuries of damp.",
      "A low ceiling presses down. The walls are scored with blade-marks.",
      "Water seeps through cracks above. The smell is rot and mineral.",
      "Darkness ahead. The silence is the kind that eats sound.",
      "Ancient carvings ring the upper wall.",
    ],
    bonusEdgeChance: 0.25,
  },

  wilderness: {
    nodeCountMin: 4,
    nodeCountMax: 8,
    featureDistribution: {
      hazard: 0.15,
      empty: 0.35,
      npc: 0.10,
      rest: 0.15,
      quest_hook: 0.10,
      exit: 0.15,
    },
    nameAdjectives: [
      "Bone", "Grey", "Blighted", "Howling", "Ashen",
      "Pale", "Drowned", "Scarred", "Cold", "Iron",
    ],
    nameNouns: [
      "Mire", "Heath", "Wastes", "Reach", "Barrow",
      "Hollow", "Fen", "Ridge", "Crossing", "Strand",
    ],
    nodeNamePool: [
      "The Ridge", "The Hollow Oak", "The Stream Crossing",
      "The Cairn", "The Thornfield", "The Old Trail",
      "The Shadowed Gully", "The Mossy Stones", "The Clearing",
      "The Boulderfall", "The Mudflats", "The Pine Stand",
      "The Outcrop", "The Dried Riverbed", "The Ancient Standing Stone",
      "The Bramble Path", "The Foggy Hollow", "The Hunter's Camp",
      "The Clifftop", "The Overgrown Road",
    ],
    descriptionPool: [
      "Wind moves through the trees. Nothing else does.",
      "The ground is uneven and the light thin.",
      "Open sky overhead. No cover in any direction.",
      "The path ends here. Ahead is rough ground and instinct.",
      "Birdsong, then silence. Something noticed you first.",
      "The land stretches flat. You are exposed.",
    ],
    bonusEdgeChance: 0.6,
  },

  ruins: {
    nodeCountMin: 5,
    nodeCountMax: 10,
    featureDistribution: {
      hazard: 0.20,
      treasure: 0.20,
      empty: 0.25,
      quest_hook: 0.10,
      exit: 0.10,
    },
    nameAdjectives: [
      "Shattered", "Crumbling", "Forgotten", "Silent", "Broken",
      "Scorched", "Buried", "Hollow", "Cursed", "Lost",
    ],
    nameNouns: [
      "Reliquary", "Hold", "Bastion", "Tower", "Sanctum",
      "Archive", "Court", "Annex", "Hall", "Citadel",
    ],
    nodeNamePool: [
      "The Broken Courtyard", "The Fallen Tower", "The Crypt Entrance",
      "The Overgrown Hall", "The Cracked Fountain", "The Sealed Door",
      "The Shattered Nave", "The Charred Beam Room", "The Sunken Floor",
      "The Collapsed Archway", "The Moss-Eaten Throne", "The Buried Vault",
      "The Ruined Staircase", "The Garden of Weeds", "The Bone-Littered Chamber",
      "The Toppled Column Hall", "The Faded Mural Room", "The Ashen Courtyard",
      "The Crumbling Battlement", "The Forgotten Shrine",
    ],
    descriptionPool: [
      "The structure was once large. Now it is broken and patient.",
      "Ivy swallows the stonework. The walls still stand—barely.",
      "Silence, except for wind through the gaps. The roof is mostly gone.",
      "Whoever built this is long dead. Whatever they feared may not be.",
      "The floor is rubble and old ash.",
    ],
    bonusEdgeChance: 0.2,
  },
};

// ---------------------------------------------------------------------------
// Pure generation helpers
// ---------------------------------------------------------------------------

/** Seeded integer in [min, max] inclusive. */
function seededInt(seed: string, min: number, max: number): number {
  return min + Math.floor(seededFloat(seed) * (max - min + 1));
}

/**
 * Weighted random feature selection using seeded PRNG.
 *
 * Iterates distribution entries sorted by weight descending.
 * Accumulates weights; returns the feature whose bucket the roll falls into.
 * Falls back to "empty" if roll exceeds total weight (distribution sums < 1.0).
 *
 * @pure — deterministic for any given seed.
 */
export function rollFeature(
  seed: string,
  distribution: Partial<Record<NodeFeature, number>>
): NodeFeature {
  const roll = seededFloat(seed);
  const sorted = (Object.entries(distribution) as [NodeFeature, number][])
    .sort(([, a], [, b]) => b - a);
  let cumulative = 0;
  for (const [feature, weight] of sorted) {
    cumulative += weight;
    if (roll < cumulative) return feature;
  }
  return "empty";
}

/**
 * Generate an evocative location name from type and seed.
 * Pattern: "The [Adjective] [Noun]"
 *
 * @pure — deterministic for any given (type, seed) pair.
 */
export function generateLocationName(type: LocationType, seed: string): string {
  const template = LOCATION_TEMPLATES[type];
  const adjective = pickSeeded(seed + ":locAdj", template.nameAdjectives);
  const noun = pickSeeded(seed + ":locNoun", template.nameNouns);
  return `The ${adjective} ${noun}`;
}

// ---------------------------------------------------------------------------
// MST + graph construction
// ---------------------------------------------------------------------------

/** Union-Find data structure for Kruskal's algorithm. */
function makeUnionFind(n: number) {
  const parent = Array.from({ length: n }, (_, i) => i);
  const rank = new Array<number>(n).fill(0);

  function find(x: number): number {
    if (parent[x] !== x) parent[x] = find(parent[x]!);
    return parent[x]!;
  }

  function union(x: number, y: number): boolean {
    const rx = find(x);
    const ry = find(y);
    if (rx === ry) return false;
    if (rank[rx]! < rank[ry]!) {
      parent[rx] = ry;
    } else if (rank[rx]! > rank[ry]!) {
      parent[ry] = rx;
    } else {
      parent[ry] = rx;
      rank[rx] = rank[rx]! + 1;
    }
    return true;
  }

  return { find, union };
}

/** Assign a passage type per edge based on location type and seeded roll. */
function assignPassageType(
  seed: string,
  fromIndex: number,
  toIndex: number,
  type: LocationType
): PassageType {
  const roll = seededFloat(`${seed}:passage:${fromIndex}:${toIndex}`);
  if (type === "dungeon") {
    if (roll < 0.30) return "door";
    if (roll < 0.40) return "locked";
    if (roll < 0.45) return "hidden";
    return "open";
  }
  if (type === "ruins") {
    if (roll < 0.15) return "collapsed";
    return "open";
  }
  return "open";
}

/**
 * Generate a fully connected node graph using:
 *   1. Seeded spatial placement (6×6 grid, jitter on collision)
 *   2. Kruskal's MST to guarantee connectivity (no orphan nodes)
 *   3. Seeded bonus edges for loops/shortcuts
 *   4. Passage type assignment per location type
 *
 * Entry node is always index 0; exit feature is always assigned to the last node.
 *
 * @pure — deterministic for any given (type, seed) pair.
 */
export function generateNodeGraph(
  type: LocationType,
  seed: string
): { nodes: NodePayload[]; edges: EdgePayload[] } {
  const template = LOCATION_TEMPLATES[type];
  const nodeCount = seededInt(`${seed}:count`, template.nodeCountMin, template.nodeCountMax);

  // ── Place nodes ─────────────────────────────────────────────────────────────
  const occupied = new Set<string>();
  const nodes: NodePayload[] = [];

  for (let i = 0; i < nodeCount; i++) {
    let x = seededInt(`${seed}:nx:${i}`, 0, 5);
    let y = seededInt(`${seed}:ny:${i}`, 0, 5);

    // Jitter up to 10 attempts if the cell is already occupied
    let attempt = 0;
    while (occupied.has(`${x},${y}`) && attempt < 10) {
      const dir = Math.floor(seededFloat(`${seed}:jitter:${i}:${attempt}`) * 4);
      if (dir === 0) x = Math.min(5, x + 1);
      else if (dir === 1) x = Math.max(0, x - 1);
      else if (dir === 2) y = Math.min(5, y + 1);
      else y = Math.max(0, y - 1);
      attempt++;
    }
    occupied.add(`${x},${y}`);

    const name = pickSeeded(`${seed}:nodeName:${i}`, template.nodeNamePool);
    const description = pickSeeded(`${seed}:nodeDesc:${i}`, template.descriptionPool);

    // Feature: last node always exits; all others are rolled
    const feature: NodeFeature =
      i === nodeCount - 1
        ? "exit"
        : rollFeature(`${seed}:feat:${i}`, template.featureDistribution);

    const npcSeed =
      feature === "npc" || feature === "shop" ? `${seed}:npc:${i}` : null;

    nodes.push({ index: i, name, description, feature, npcSeed, featureData: {}, x, y });
  }

  // ── Build edges — Kruskal's MST + bonus edges ────────────────────────────────
  interface EdgeCandidate {
    fromIndex: number;
    toIndex: number;
    distance: number;
  }

  const candidates: EdgeCandidate[] = [];
  for (let i = 0; i < nodeCount; i++) {
    for (let j = i + 1; j < nodeCount; j++) {
      const ni = nodes[i]!;
      const nj = nodes[j]!;
      const dx = ni.x - nj.x;
      const dy = ni.y - nj.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      candidates.push({ fromIndex: i, toIndex: j, distance });
    }
  }

  // Sort deterministically: by distance, then fromIndex, then toIndex
  candidates.sort((a, b) =>
    a.distance !== b.distance
      ? a.distance - b.distance
      : a.fromIndex !== b.fromIndex
      ? a.fromIndex - b.fromIndex
      : a.toIndex - b.toIndex
  );

  const uf = makeUnionFind(nodeCount);
  const mstEdgeSet = new Set<string>();
  const edges: EdgePayload[] = [];

  // Phase 1: MST
  for (const { fromIndex, toIndex } of candidates) {
    if (uf.union(fromIndex, toIndex)) {
      mstEdgeSet.add(`${fromIndex}:${toIndex}`);
      edges.push({
        fromIndex,
        toIndex,
        passageType: assignPassageType(seed, fromIndex, toIndex, type),
      });
    }
  }

  // Phase 2: bonus edges for loops and shortcuts
  for (const { fromIndex, toIndex } of candidates) {
    if (!mstEdgeSet.has(`${fromIndex}:${toIndex}`)) {
      const roll = seededFloat(`${seed}:edge:${fromIndex}:${toIndex}`);
      if (roll < template.bonusEdgeChance) {
        edges.push({
          fromIndex,
          toIndex,
          passageType: assignPassageType(seed, fromIndex, toIndex, type),
        });
      }
    }
  }

  return { nodes, edges };
}

/**
 * Orchestrator: generates a complete, validated LocationPayload from inputs.
 *
 * @pure — given identical inputs, always returns identical output.
 * @throws if the generated graph fails minimum-size invariants (should never
 *         happen given template min values, but guards against corrupt input).
 */
export function generateLocationPayload(input: {
  locationType: LocationType;
  seed: string;
}): LocationPayload {
  const template = LOCATION_TEMPLATES[input.locationType];
  const name = generateLocationName(input.locationType, input.seed);
  const description = pickSeeded(`${input.seed}:desc`, template.descriptionPool);
  const { nodes, edges } = generateNodeGraph(input.locationType, input.seed);

  if (nodes.length < 2) {
    throw new Error(
      `generateLocationPayload: expected ≥2 nodes, got ${nodes.length}`
    );
  }
  if (edges.length < 1) {
    throw new Error(
      `generateLocationPayload: expected ≥1 edge, got ${edges.length}`
    );
  }

  return {
    name,
    type: input.locationType,
    description,
    nodes,
    edges,
    entryNodeIndex: 0,
    seed: input.seed,
  };
}

// ---------------------------------------------------------------------------
// Navigation helpers
// ---------------------------------------------------------------------------

/**
 * Returns true if the player can legally move from `currentNodeIndex` to
 * `targetNodeIndex` given the current edge list.
 *
 * Edges are bidirectional: A→B implies B→A is also traversable.
 * Moving to the current node (staying put) always returns true.
 *
 * @pure — no side effects.
 */
export function canMoveToNode(
  currentNodeIndex: number,
  targetNodeIndex: number,
  edges: EdgePayload[]
): boolean {
  if (currentNodeIndex === targetNodeIndex) return true;
  return edges.some(
    (e) =>
      (e.fromIndex === currentNodeIndex && e.toIndex === targetNodeIndex) ||
      (e.fromIndex === targetNodeIndex && e.toIndex === currentNodeIndex)
  );
}

/**
 * Returns a formatted description of the current node for injection into the
 * AI system prompt. Includes the node name, description, feature details,
 * and a list of available exits with their passage types.
 *
 * @pure — no side effects.
 */
export function describeCurrentNode(
  node: NodePayload,
  adjacentNodes: NodePayload[],
  edges: EdgePayload[]
): string {
  const featureDetails: Record<NodeFeature, string> = {
    empty: "Nothing of immediate note.",
    npc: "An NPC is present here.",
    hazard: "A hazard threatens anyone who lingers.",
    treasure: "Lootable items or containers are visible.",
    quest_hook: "A clue, notice, or story hook is present.",
    rest: "A safe resting point is available.",
    shop: "A merchant or vendor operates here.",
    exit: "This area leads onward or out.",
  };

  const lines: string[] = [
    `## Current Location: ${node.name}`,
    node.description,
    "",
    `**Feature:** ${node.feature} — ${featureDetails[node.feature]}`,
    "**Exits:**",
  ];

  if (adjacentNodes.length === 0) {
    lines.push("  (None — dead end)");
  } else {
    for (const adj of adjacentNodes) {
      const edge = edges.find(
        (e) =>
          (e.fromIndex === node.index && e.toIndex === adj.index) ||
          (e.fromIndex === adj.index && e.toIndex === node.index)
      );
      const passage = edge?.passageType ?? "open";
      lines.push(`  - ${adj.name} [${passage}]`);
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Exploration Time Engine — Milestone O
// Pure functions only. No I/O, no Prisma, no side effects.
// ---------------------------------------------------------------------------

// ── Constants ────────────────────────────────────────────────────────────────

/** 1 dungeon turn = 10 minutes. 6 turns = 1 hour. */
export const TURNS_PER_HOUR = 6;
/** A lit torch burns for 6 turns (1 hour). */
export const TORCH_DURATION_TURNS = 6;
/** A lantern burning on one oil flask lasts 24 turns (4 hours). */
export const OIL_DURATION_TURNS = 24;
/** An encounter check roll fires every 2 turns. */
export const ENCOUNTER_CHECK_INTERVAL_TURNS = 2;
/** A 1d6 result of 1 triggers a random encounter. */
export const ENCOUNTER_TRIGGER_RESULT = 1;
/** The party must rest 1 turn out of every 6. */
export const REST_INTERVAL_TURNS = 6;
/** Rations are consumed once per 24 hours = 144 turns (6 turns/hour × 24). */
export const RATION_INTERVAL_TURNS = 144;
/** Torches given to each player at campaign creation. */
export const INITIAL_TORCHES_PER_PLAYER = 5;
/** Rations given to each player at campaign creation. */
export const INITIAL_RATIONS_PER_PLAYER = 7;

// ── Types ────────────────────────────────────────────────────────────────────

export type ActiveLightSource = "torch" | "lantern" | "none";

/** Mirror of the CampaignTime DB row — contains only the fields pure functions need. */
export interface CampaignTimeState {
  totalTurns:                  number;
  totalHours:                  number;
  turnsSinceRest:              number;
  turnsSinceEncounterCheck:    number;
  turnsSinceRation:            number;
}

/** Returned by `advanceTurn`. Caller writes `next` to DB and acts on flags. */
export interface AdvanceTurnResult {
  /** New CampaignTimeState — write this atomically to the DB. */
  next:                  CampaignTimeState;
  /** True when the party has gone 6 turns without resting. Rest is mandatory. */
  restRequired:          boolean;
  /** True when an encounter check should be rolled this advance. */
  encounterCheckDue:     boolean;
  /** True when rations should be consumed this advance. */
  rationConsumptionDue:  boolean;
  /** Number of turns actually advanced (echoes clamped input). */
  turnsAdvanced:         number;
}

/** Mirror of the PartyInventory DB row. */
export interface PartyInventoryState {
  torches:                   number;
  oilFlasks:                 number;
  rations:                   number;
  activeLightSource:         ActiveLightSource;
  lightSourceTurnsRemaining: number;
}

export interface ConsumeResourcesOptions {
  /** True when rations should be deducted this turn (from AdvanceTurnResult). */
  rationConsumptionDue: boolean;
  /** Number of active party members — scales ration consumption. */
  partySize:            number;
}

/** Returned by `consumeResources`. Caller writes `next` to DB. */
export interface ConsumeResourcesResult {
  /** New PartyInventoryState — write this atomically to the DB. */
  next:                    PartyInventoryState;
  /** True when the active light source ran out this turn. */
  lightExpired:            boolean;
  /** True when rations hit 0 after this turn's consumption. */
  rationsDepleted:         boolean;
  /** True when the engine automatically lit the next torch or lantern. */
  lightSourceAutoSelected: boolean;
  /** Narrator-facing plain-text warnings to voice diegetically. */
  warnings:                string[];
}

/** Returned by `checkRandomEncounter`. */
export interface EncounterCheckResult {
  /** Raw 1d6 result (1–6). */
  roll:       number;
  /** True when roll === ENCOUNTER_TRIGGER_RESULT (1). */
  triggered:  boolean;
  /** Echoes the loudAction input. */
  loudAction: boolean;
}

// ── Internal helpers ─────────────────────────────────────────────────────────

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// ── Pure engine functions ─────────────────────────────────────────────────────

/**
 * Advances the campaign clock by `turns` dungeon turns (default 1, clamped [1, 6]).
 *
 * Computes the next CampaignTimeState and raises boolean flags for the
 * integration layer to act on (rest, encounter check, ration consumption).
 *
 * `turnsSinceRest` is capped at REST_INTERVAL_TURNS — it never overflows.
 * If the caller does not call `applyRest()` when `restRequired` is true,
 * the next call will immediately return `restRequired = true` again,
 * signalling that the party has skipped their rest (exhaustion applies).
 *
 * @pure — no I/O, no side effects.
 */
export function advanceTurn(
  state: CampaignTimeState,
  turns = 1,
): AdvanceTurnResult {
  const turnsAdvanced = clampInt(turns, 1, 6);

  const totalTurns = state.totalTurns + turnsAdvanced;
  const totalHours = Math.floor(totalTurns / TURNS_PER_HOUR);

  // Rest cycle — cap at REST_INTERVAL_TURNS, never overflow
  const rawTurnsSinceRest = state.turnsSinceRest + turnsAdvanced;
  const restRequired = rawTurnsSinceRest >= REST_INTERVAL_TURNS;
  const turnsSinceRest = clampInt(rawTurnsSinceRest, 0, REST_INTERVAL_TURNS);

  // Encounter check cycle — fires and resets modulo ENCOUNTER_CHECK_INTERVAL_TURNS
  const rawEncounter = state.turnsSinceEncounterCheck + turnsAdvanced;
  const encounterCheckDue = rawEncounter >= ENCOUNTER_CHECK_INTERVAL_TURNS;
  const turnsSinceEncounterCheck = rawEncounter % ENCOUNTER_CHECK_INTERVAL_TURNS;

  // Ration cycle — fires and resets modulo RATION_INTERVAL_TURNS
  const rawRation = state.turnsSinceRation + turnsAdvanced;
  const rationConsumptionDue = rawRation >= RATION_INTERVAL_TURNS;
  const turnsSinceRation = rawRation % RATION_INTERVAL_TURNS;

  return {
    next: {
      totalTurns,
      totalHours,
      turnsSinceRest,
      turnsSinceEncounterCheck,
      turnsSinceRation,
    },
    restRequired,
    encounterCheckDue,
    rationConsumptionDue,
    turnsAdvanced,
  };
}

/**
 * Performs the OSR 1d6 random encounter check.
 *
 * A result of ENCOUNTER_TRIGGER_RESULT (1) triggers an encounter.
 * `loudAction` forces the check to fire regardless of the encounter interval
 * timer, but does not guarantee a trigger — the roll still determines outcome.
 *
 * `forcedRoll` is a test-only seam. Production code must never pass it.
 *
 * @pure — the only randomness is the single rollDie(6) call.
 */
export function checkRandomEncounter(
  loudAction = false,
  forcedRoll?: number,
): EncounterCheckResult {
  const roll = forcedRoll !== undefined
    ? clampInt(Math.floor(forcedRoll), 1, 6)
    : rollDie(6);
  return {
    roll,
    triggered: roll === ENCOUNTER_TRIGGER_RESULT,
    loudAction,
  };
}

/**
 * Computes the next PartyInventory state after one turn's resource consumption.
 *
 * Light source rules (Q3 — torches first):
 *   1. Decrement `lightSourceTurnsRemaining` by 1.
 *   2. If it reaches 0:
 *      a. If torches > 0 → light a torch (torches--, remaining = TORCH_DURATION_TURNS).
 *      b. Else if oilFlasks > 0 → light a lantern (oilFlasks--, remaining = OIL_DURATION_TURNS).
 *      c. Else → darkness (activeLightSource = "none", remaining = 0).
 *
 * Ration rules:
 *   - Only consume when `rationConsumptionDue` is true.
 *   - Deduct `partySize` rations; floor at 0 (never negative).
 *
 * @pure — no I/O, no side effects.
 */
export function consumeResources(
  inventory: PartyInventoryState,
  options: ConsumeResourcesOptions,
): ConsumeResourcesResult {
  const warnings: string[] = [];
  let lightExpired = false;
  let lightSourceAutoSelected = false;

  // ── Light source ───────────────────────────────────────────────────────────
  let {
    torches,
    oilFlasks,
    activeLightSource,
    lightSourceTurnsRemaining,
  } = inventory;

  if (lightSourceTurnsRemaining > 0) {
    lightSourceTurnsRemaining -= 1;
  }

  if (lightSourceTurnsRemaining === 0 && activeLightSource !== "none") {
    lightExpired = true;
    lightSourceAutoSelected = true;

    if (torches > 0) {
      torches -= 1;
      activeLightSource = "torch";
      lightSourceTurnsRemaining = TORCH_DURATION_TURNS;
      if (torches === 0) {
        warnings.push("Last torch lit — no unlit torches remain.");
      }
    } else if (oilFlasks > 0) {
      oilFlasks -= 1;
      activeLightSource = "lantern";
      lightSourceTurnsRemaining = OIL_DURATION_TURNS;
      if (oilFlasks === 0) {
        warnings.push("Last oil flask loaded into the lantern.");
      }
    } else {
      activeLightSource = "none";
      lightSourceTurnsRemaining = 0;
      warnings.push("Darkness. The last light source has burned out.");
    }
  }

  // ── Rations ────────────────────────────────────────────────────────────────
  let { rations } = inventory;
  let rationsDepleted = false;

  if (options.rationConsumptionDue) {
    rations = Math.max(0, rations - options.partySize);
    if (rations === 0) {
      rationsDepleted = true;
      warnings.push("Rations depleted — the party has nothing left to eat.");
    } else if (rations <= options.partySize) {
      warnings.push(`Only ${rations} ration${rations === 1 ? "" : "s"} remain — enough for one more meal.`);
    }
  }

  return {
    next: {
      torches,
      oilFlasks,
      rations,
      activeLightSource,
      lightSourceTurnsRemaining,
    },
    lightExpired,
    rationsDepleted,
    lightSourceAutoSelected,
    warnings,
  };
}

/**
 * Resets the rest cycle counter after the party takes a mandatory rest turn.
 * Call this when `action === "rest"` in the integration layer.
 *
 * @pure — no I/O, no side effects.
 */
export function applyRest(state: CampaignTimeState): CampaignTimeState {
  return { ...state, turnsSinceRest: 0 };
}

/**
 * Computes the initial PartyInventory values for a newly created campaign.
 * Torches and rations are seeded per the Q4 architect decision.
 * No oil flasks are provided — they must be purchased in-world.
 *
 * @pure — no I/O, no side effects.
 */
export function initialPartyInventory(partySize: number): PartyInventoryState {
  return {
    torches:                   INITIAL_TORCHES_PER_PLAYER * partySize,
    oilFlasks:                 0,
    rations:                   INITIAL_RATIONS_PER_PLAYER * partySize,
    activeLightSource:         "none",
    lightSourceTurnsRemaining: 0,
  };
}
