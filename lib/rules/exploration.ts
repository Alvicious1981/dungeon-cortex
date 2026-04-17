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

export const ExplorationTurnInputSchema = z.object({
  action: z
    .enum(["move", "search", "rest", "interact", "loud"])
    .describe(
      "The type of exploration action taken. " +
      "'move': standard movement to adjacent node, 1 turn. " +
      "'search': careful room examination, 1 turn. " +
      "'rest': mandatory rest turn — resets the rest cycle, no resources consumed. " +
      "'interact': non-combat interaction with environment or NPC, 1 turn. " +
      "'loud': noisy action (breaking down door, shouting) — forces an immediate encounter check.",
    ),
  turnsToAdvance: z
    .number()
    .int()
    .min(1)
    .max(6)
    .default(1)
    .describe(
      "How many turns this action consumes. Default 1. " +
      "Only exceed 1 for explicitly multi-turn tasks such as extended rituals or camp setup.",
    ),
}).strict();

export type ExplorationTurnInput = z.infer<typeof ExplorationTurnInputSchema>;

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
// Exploration Time Engine Constants & Types
// ---------------------------------------------------------------------------

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
  next:                  CampaignTimeState;
  restRequired:          boolean;
  encounterCheckDue:     boolean;
  rationConsumptionDue:  boolean;
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
  rationConsumptionDue: boolean;
  partySize:            number;
}

/** Returned by `consumeResources`. Caller writes `next` to DB. */
export interface ConsumeResourcesResult {
  next:                    PartyInventoryState;
  lightExpired:            boolean;
  rationsDepleted:         boolean;
  lightSourceAutoSelected: boolean;
  warnings:                string[];
}

/** Returned by `checkRandomEncounter`. */
export interface EncounterCheckResult {
  roll:       number;
  triggered:  boolean;
  loudAction: boolean;
}

// ---------------------------------------------------------------------------
// Pure logic — Re-exported from exploration-logic.ts
// ---------------------------------------------------------------------------

export {
  rollFeature,
  generateLocationName,
  generateNodeGraph,
  generateLocationPayload,
  canMoveToNode,
  describeCurrentNode,
  advanceTurn,
  checkRandomEncounter,
  consumeResources,
  applyRest,
  initialPartyInventory,
} from "./exploration-logic";
