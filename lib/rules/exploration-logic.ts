/**
 * lib/rules/exploration-logic.ts
 *
 * Exploration & Time Engine — Milestone O Logic Layer.
 *
 * Architectural contract ("Code is Law"):
 *   This module contains ONLY pure functions for exploration logic,
 *   navigation, time advancement, and resource consumption.
 *   DO NOT perform I/O, Prisma queries, or side effects here.
 *   All deterministic state changes are computed here and returned
 *   to the caller (Narrator/Tools) for persistence.
 */

import { seededFloat, pickSeeded } from "@/lib/rules/generators";
import {
  LOCATION_TEMPLATES,
  TURNS_PER_HOUR,
  REST_INTERVAL_TURNS,
  ENCOUNTER_CHECK_INTERVAL_TURNS,
  RATION_INTERVAL_TURNS,
  TORCH_DURATION_TURNS,
  OIL_DURATION_TURNS,
  ENCOUNTER_TRIGGER_RESULT,
  type LocationType,
  type NodeFeature,
  type PassageType,
  type NodePayload,
  type EdgePayload,
  type LocationPayload,
  type CampaignTimeState,
  type AdvanceTurnResult,
  type PartyInventoryState,
  type ConsumeResourcesOptions,
  type ConsumeResourcesResult,
  type EncounterCheckResult,
} from "./exploration";

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

export function generateNodeGraph(
  type: LocationType,
  seed: string
): { nodes: NodePayload[]; edges: EdgePayload[] } {
  const template = LOCATION_TEMPLATES[type];
  const nodeCount = seededInt(`${seed}:count`, template.nodeCountMin, template.nodeCountMax);

  const occupied = new Set<string>();
  const nodes: NodePayload[] = [];

  for (let i = 0; i < nodeCount; i++) {
    let x = seededInt(`${seed}:nx:${i}`, 0, 5);
    let y = seededInt(`${seed}:ny:${i}`, 0, 5);

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

    const feature: NodeFeature =
      i === nodeCount - 1
        ? "exit"
        : rollFeature(`${seed}:feat:${i}`, template.featureDistribution);

    const npcSeed =
      feature === "npc" || feature === "shop" ? `${seed}:npc:${i}` : null;

    nodes.push({ index: i, name, description, feature, npcSeed, featureData: {}, x, y });
  }

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
// Exploration Time Engine logic
// ---------------------------------------------------------------------------

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function advanceTurn(
  state: CampaignTimeState,
  turns = 1,
): AdvanceTurnResult {
  const turnsAdvanced = clampInt(turns, 1, 6);

  const totalTurns = state.totalTurns + turnsAdvanced;
  const totalHours = Math.floor(totalTurns / TURNS_PER_HOUR);

  const rawTurnsSinceRest = state.turnsSinceRest + turnsAdvanced;
  const restRequired = rawTurnsSinceRest >= REST_INTERVAL_TURNS;
  const turnsSinceRest = clampInt(rawTurnsSinceRest, 0, REST_INTERVAL_TURNS);

  const rawEncounter = state.turnsSinceEncounterCheck + turnsAdvanced;
  const encounterCheckDue = rawEncounter >= ENCOUNTER_CHECK_INTERVAL_TURNS;
  const turnsSinceEncounterCheck = rawEncounter % ENCOUNTER_CHECK_INTERVAL_TURNS;

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

export function checkRandomEncounter(loudAction: boolean, forcedRoll?: number): EncounterCheckResult {
  const roll = forcedRoll ?? Math.floor(Math.random() * 6) + 1;
  const threshold = loudAction ? ENCOUNTER_TRIGGER_RESULT + 1 : ENCOUNTER_TRIGGER_RESULT;
  return {
    roll,
    triggered: roll <= threshold,
    loudAction,
  };
}

export function consumeResources(
  inventory: PartyInventoryState,
  options: ConsumeResourcesOptions = { rationConsumptionDue: false, partySize: 1 },
  turnsAdvanced = 1
): ConsumeResourcesResult {
  const next = { ...inventory };
  const warnings: string[] = [];
  let lightExpired = false;
  let rationsDepleted = false;
  let lightSourceAutoSelected = false;

  if (next.activeLightSource !== "none") {
    next.lightSourceTurnsRemaining -= turnsAdvanced;

    if (next.lightSourceTurnsRemaining <= 0) {
      lightExpired = true; // One expired (Q3)
      if (next.activeLightSource === "torch") {
        if (next.torches > 0) {
          next.torches -= 1;
          next.lightSourceTurnsRemaining = TORCH_DURATION_TURNS;
          lightSourceAutoSelected = true;
          warnings.push("A torch sputters out, but you quickly light another.");
        } else if (next.oilFlasks > 0) {
          // Fallback to lantern (Q3)
          next.activeLightSource = "lantern";
          next.oilFlasks -= 1;
          next.lightSourceTurnsRemaining = OIL_DURATION_TURNS;
          lightSourceAutoSelected = true;
          warnings.push("Your last torch dies, but you quickly strike a spark for the lantern.");
        } else {
          next.activeLightSource = "none";
          next.lightSourceTurnsRemaining = 0;
          warnings.push("Your last torch dies. Darkness swallows the party.");
        }
      } else if (next.activeLightSource === "lantern") {
        if (next.oilFlasks > 0) {
          next.oilFlasks -= 1;
          next.lightSourceTurnsRemaining = OIL_DURATION_TURNS;
          lightSourceAutoSelected = true;
          warnings.push("The lantern flickers, but you refill it and keep it burning.");
        } else {
          next.activeLightSource = "none";
          next.lightSourceTurnsRemaining = 0;
          lightExpired = true;
          warnings.push("The lantern runs dry. You are plunged into total darkness.");
        }
      }
    } else if (next.lightSourceTurnsRemaining === 1) {
      warnings.push(`The ${next.activeLightSource} is guttering — it will soon expire.`);
    }
  }

  if (options.rationConsumptionDue) {
    const amount = options.partySize;
    if (next.rations >= amount) {
      next.rations -= amount;
      warnings.push("The party stops to consume a day's rations.");
      if (next.rations === 0) rationsDepleted = true;
    } else {
      next.rations = 0;
      rationsDepleted = true;
      warnings.push("You are out of rations. Starvation begins to set in.");
    }
  }

  return {
    next,
    lightExpired,
    rationsDepleted,
    lightSourceAutoSelected,
    warnings,
  };
}

export function applyRest(state: CampaignTimeState): CampaignTimeState {
  return {
    ...state,
    turnsSinceRest: 0,
  };
}

export const initialPartyInventory = (partySize: number): PartyInventoryState => ({
  torches: 5 * partySize,
  oilFlasks: 0,
  rations: 7 * partySize,
  activeLightSource: "none",
  lightSourceTurnsRemaining: 0,
});
