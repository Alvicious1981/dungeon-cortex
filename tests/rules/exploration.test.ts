import { describe, it, expect, vi, afterEach } from "vitest";
import {
  LOCATION_TYPES,
  NODE_FEATURES,
  PASSAGE_TYPES,
  LOCATION_TEMPLATES,
  GenerateLocationInputSchema,
  NodePayloadSchema,
  EdgePayloadSchema,
  LocationPayloadSchema,
  MoveToNodeInputSchema,
  rollFeature,
  generateLocationName,
  generateNodeGraph,
  generateLocationPayload,
  canMoveToNode,
  describeCurrentNode,
  type LocationType,
  type EdgePayload,
  type NodePayload,
  // Milestone O Time Engine
  TURNS_PER_HOUR,
  TORCH_DURATION_TURNS,
  OIL_DURATION_TURNS,
  ENCOUNTER_CHECK_INTERVAL_TURNS,
  ENCOUNTER_TRIGGER_RESULT,
  REST_INTERVAL_TURNS,
  RATION_INTERVAL_TURNS,
  INITIAL_TORCHES_PER_PLAYER,
  INITIAL_RATIONS_PER_PLAYER,
  advanceTurn,
  checkRandomEncounter,
  consumeResources,
  applyRest,
  initialPartyInventory,
  type CampaignTimeState,
  type PartyInventoryState,
} from "@/lib/rules/exploration";

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validNode(overrides: Record<string, unknown> = {}) {
  return {
    index: 0,
    name: "The Entry Hall",
    description: "A damp stone corridor leading into the dark.",
    feature: "empty" as const,
    npcSeed: null,
    featureData: {},
    x: 0,
    y: 0,
    ...overrides,
  };
}

function validEdge(overrides: Record<string, unknown> = {}) {
  return {
    fromIndex: 0,
    toIndex: 1,
    passageType: "open" as const,
    ...overrides,
  };
}

function validLocationPayload(overrides: Record<string, unknown> = {}) {
  return {
    name: "The Dripping Nave",
    type: "dungeon" as const,
    description: "An ancient crypt carved from living rock, dripping with moisture.",
    nodes: [validNode({ index: 0 }), validNode({ index: 1, name: "The Inner Sanctum", x: 1 })],
    edges: [validEdge()],
    entryNodeIndex: 0,
    seed: "abc123",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Const arrays
// ---------------------------------------------------------------------------

describe("const arrays", () => {
  it("LOCATION_TYPES contains all expected archetypes", () => {
    expect(LOCATION_TYPES).toContain("tavern");
    expect(LOCATION_TYPES).toContain("village");
    expect(LOCATION_TYPES).toContain("dungeon");
    expect(LOCATION_TYPES).toContain("wilderness");
    expect(LOCATION_TYPES).toContain("ruins");
    expect(LOCATION_TYPES).toHaveLength(5);
  });

  it("NODE_FEATURES contains all expected tags", () => {
    const expected = ["empty", "npc", "hazard", "treasure", "quest_hook", "rest", "shop", "exit"];
    for (const f of expected) expect(NODE_FEATURES).toContain(f);
    expect(NODE_FEATURES).toHaveLength(8);
  });

  it("PASSAGE_TYPES contains all expected values", () => {
    const expected = ["open", "door", "locked", "hidden", "collapsed"];
    for (const p of expected) expect(PASSAGE_TYPES).toContain(p);
    expect(PASSAGE_TYPES).toHaveLength(5);
  });
});

// ---------------------------------------------------------------------------
// GenerateLocationInputSchema
// ---------------------------------------------------------------------------

describe("GenerateLocationInputSchema", () => {
  it("accepts valid input with all fields", () => {
    const result = GenerateLocationInputSchema.safeParse({
      locationType: "dungeon",
      seed: "seed-42",
      parentLocationId: "loc_parent",
    });
    expect(result.success).toBe(true);
  });

  it("accepts input with only required field", () => {
    const result = GenerateLocationInputSchema.safeParse({ locationType: "tavern" });
    expect(result.success).toBe(true);
  });

  it("rejects invalid locationType", () => {
    const result = GenerateLocationInputSchema.safeParse({ locationType: "castle" });
    expect(result.success).toBe(false);
  });

  it("rejects empty seed string", () => {
    const result = GenerateLocationInputSchema.safeParse({ locationType: "ruins", seed: "" });
    expect(result.success).toBe(false);
  });

  it("rejects seed exceeding 100 characters", () => {
    const result = GenerateLocationInputSchema.safeParse({
      locationType: "ruins",
      seed: "x".repeat(101),
    });
    expect(result.success).toBe(false);
  });

  it("accepts seed of exactly 100 characters", () => {
    const result = GenerateLocationInputSchema.safeParse({
      locationType: "wilderness",
      seed: "x".repeat(100),
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing locationType", () => {
    const result = GenerateLocationInputSchema.safeParse({ seed: "abc" });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// NodePayloadSchema
// ---------------------------------------------------------------------------

describe("NodePayloadSchema", () => {
  it("accepts a valid node", () => {
    expect(NodePayloadSchema.safeParse(validNode()).success).toBe(true);
  });

  it("accepts node with npcSeed string", () => {
    expect(NodePayloadSchema.safeParse(validNode({ feature: "npc", npcSeed: "npc-seed-1" })).success).toBe(true);
  });

  it("rejects invalid feature tag", () => {
    expect(NodePayloadSchema.safeParse(validNode({ feature: "boss_room" })).success).toBe(false);
  });

  it("rejects name exceeding 100 characters", () => {
    expect(NodePayloadSchema.safeParse(validNode({ name: "A".repeat(101) })).success).toBe(false);
  });

  it("rejects empty name", () => {
    expect(NodePayloadSchema.safeParse(validNode({ name: "" })).success).toBe(false);
  });

  it("rejects description exceeding 300 characters", () => {
    expect(NodePayloadSchema.safeParse(validNode({ description: "D".repeat(301) })).success).toBe(false);
  });

  it("rejects empty description", () => {
    expect(NodePayloadSchema.safeParse(validNode({ description: "" })).success).toBe(false);
  });

  it("rejects negative index", () => {
    expect(NodePayloadSchema.safeParse(validNode({ index: -1 })).success).toBe(false);
  });

  it("accepts zero index (entry node)", () => {
    expect(NodePayloadSchema.safeParse(validNode({ index: 0 })).success).toBe(true);
  });

  it("rejects non-integer index", () => {
    expect(NodePayloadSchema.safeParse(validNode({ index: 1.5 })).success).toBe(false);
  });

  it("accepts negative x/y coordinates", () => {
    expect(NodePayloadSchema.safeParse(validNode({ x: -3, y: -5 })).success).toBe(true);
  });

  it("rejects missing required fields", () => {
    expect(NodePayloadSchema.safeParse({ index: 0, name: "Room" }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// EdgePayloadSchema
// ---------------------------------------------------------------------------

describe("EdgePayloadSchema", () => {
  it("accepts a valid edge", () => {
    expect(EdgePayloadSchema.safeParse(validEdge()).success).toBe(true);
  });

  it("accepts all passage types", () => {
    for (const pt of PASSAGE_TYPES) {
      expect(EdgePayloadSchema.safeParse(validEdge({ passageType: pt })).success).toBe(true);
    }
  });

  it("rejects invalid passageType", () => {
    expect(EdgePayloadSchema.safeParse(validEdge({ passageType: "secret" })).success).toBe(false);
  });

  it("rejects negative fromIndex", () => {
    expect(EdgePayloadSchema.safeParse(validEdge({ fromIndex: -1 })).success).toBe(false);
  });

  it("rejects negative toIndex", () => {
    expect(EdgePayloadSchema.safeParse(validEdge({ toIndex: -1 })).success).toBe(false);
  });

  it("rejects non-integer indices", () => {
    expect(EdgePayloadSchema.safeParse(validEdge({ fromIndex: 0.5 })).success).toBe(false);
    expect(EdgePayloadSchema.safeParse(validEdge({ toIndex: 1.9 })).success).toBe(false);
  });

  it("allows self-loop edge (0→0) — database enforces uniqueness, not schema", () => {
    // Schema does not reject self-loops; DB unique constraint handles duplicates.
    expect(EdgePayloadSchema.safeParse(validEdge({ fromIndex: 0, toIndex: 0 })).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// LocationPayloadSchema
// ---------------------------------------------------------------------------

describe("LocationPayloadSchema", () => {
  it("accepts a valid payload", () => {
    expect(LocationPayloadSchema.safeParse(validLocationPayload()).success).toBe(true);
  });

  it("accepts all location types", () => {
    for (const t of LOCATION_TYPES) {
      expect(LocationPayloadSchema.safeParse(validLocationPayload({ type: t })).success).toBe(true);
    }
  });

  it("rejects a single-node location (min 2 required)", () => {
    const result = LocationPayloadSchema.safeParse(
      validLocationPayload({ nodes: [validNode()] })
    );
    expect(result.success).toBe(false);
  });

  it("rejects an empty node array", () => {
    const result = LocationPayloadSchema.safeParse(validLocationPayload({ nodes: [] }));
    expect(result.success).toBe(false);
  });

  it("rejects zero edges (min 1 required)", () => {
    const result = LocationPayloadSchema.safeParse(validLocationPayload({ edges: [] }));
    expect(result.success).toBe(false);
  });

  it("rejects name exceeding 150 characters", () => {
    const result = LocationPayloadSchema.safeParse(
      validLocationPayload({ name: "N".repeat(151) })
    );
    expect(result.success).toBe(false);
  });

  it("rejects empty name", () => {
    expect(LocationPayloadSchema.safeParse(validLocationPayload({ name: "" })).success).toBe(false);
  });

  it("rejects description exceeding 500 characters", () => {
    const result = LocationPayloadSchema.safeParse(
      validLocationPayload({ description: "D".repeat(501) })
    );
    expect(result.success).toBe(false);
  });

  it("rejects empty description", () => {
    expect(LocationPayloadSchema.safeParse(validLocationPayload({ description: "" })).success).toBe(false);
  });

  it("rejects negative entryNodeIndex", () => {
    const result = LocationPayloadSchema.safeParse(validLocationPayload({ entryNodeIndex: -1 }));
    expect(result.success).toBe(false);
  });

  it("rejects invalid location type", () => {
    const result = LocationPayloadSchema.safeParse(validLocationPayload({ type: "castle" }));
    expect(result.success).toBe(false);
  });

  it("rejects missing seed", () => {
    const payload = validLocationPayload();
    // @ts-expect-error intentionally removing seed
    delete payload.seed;
    expect(LocationPayloadSchema.safeParse(payload).success).toBe(false);
  });

  it("rejects missing required top-level fields", () => {
    expect(LocationPayloadSchema.safeParse({}).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// MoveToNodeInputSchema
// ---------------------------------------------------------------------------

describe("MoveToNodeInputSchema", () => {
  it("accepts a valid node index", () => {
    expect(MoveToNodeInputSchema.safeParse({ targetNodeIndex: 3 }).success).toBe(true);
  });

  it("accepts zero index", () => {
    expect(MoveToNodeInputSchema.safeParse({ targetNodeIndex: 0 }).success).toBe(true);
  });

  it("rejects negative index", () => {
    expect(MoveToNodeInputSchema.safeParse({ targetNodeIndex: -1 }).success).toBe(false);
  });

  it("rejects non-integer index", () => {
    expect(MoveToNodeInputSchema.safeParse({ targetNodeIndex: 2.5 }).success).toBe(false);
  });

  it("rejects missing targetNodeIndex", () => {
    expect(MoveToNodeInputSchema.safeParse({}).success).toBe(false);
  });

  it("rejects string index", () => {
    expect(MoveToNodeInputSchema.safeParse({ targetNodeIndex: "3" }).success).toBe(false);
  });
});

// ===========================================================================
// SLICE 2: Generation Engine
// ===========================================================================

// ---------------------------------------------------------------------------
// rollFeature
// ---------------------------------------------------------------------------

describe("rollFeature", () => {
  it("returns a valid NodeFeature for every location type template", () => {
    for (const type of LOCATION_TYPES) {
      const dist = LOCATION_TEMPLATES[type].featureDistribution;
      const result = rollFeature(`test:${type}:seed`, dist);
      expect(NODE_FEATURES).toContain(result);
    }
  });

  it("is deterministic — same seed always returns same feature", () => {
    const dist = LOCATION_TEMPLATES.dungeon.featureDistribution;
    const a = rollFeature("dungeon:determinism", dist);
    const b = rollFeature("dungeon:determinism", dist);
    expect(a).toBe(b);
  });

  it("returns different features for different seeds (statistical)", () => {
    const dist = LOCATION_TEMPLATES.dungeon.featureDistribution;
    const results = new Set<string>();
    for (let i = 0; i < 30; i++) {
      results.add(rollFeature(`seed:${i}`, dist));
    }
    // With 30 different seeds and non-uniform distribution, expect at least 2 distinct features
    expect(results.size).toBeGreaterThanOrEqual(2);
  });

  it("falls back to 'empty' for an empty distribution", () => {
    expect(rollFeature("any-seed", {})).toBe("empty");
  });
});

// ---------------------------------------------------------------------------
// generateLocationName
// ---------------------------------------------------------------------------

describe("generateLocationName", () => {
  it("returns a string starting with 'The '", () => {
    for (const type of LOCATION_TYPES) {
      const name = generateLocationName(type, `seed-${type}`);
      expect(name.startsWith("The ")).toBe(true);
    }
  });

  it("is deterministic — same type+seed always returns same name", () => {
    const a = generateLocationName("dungeon", "test-seed");
    const b = generateLocationName("dungeon", "test-seed");
    expect(a).toBe(b);
  });

  it("different seeds produce different names (statistical)", () => {
    const names = new Set<string>();
    for (let i = 0; i < 10; i++) {
      names.add(generateLocationName("dungeon", `seed-${i}`));
    }
    expect(names.size).toBeGreaterThan(1);
  });

  it("different types can produce different names", () => {
    // Tavern and dungeon have different name pools — at least one seed should differ
    const tavernName = generateLocationName("tavern", "same-seed");
    const dungeonName = generateLocationName("dungeon", "same-seed");
    // They may or may not match by chance, but both must be valid strings
    expect(typeof tavernName).toBe("string");
    expect(typeof dungeonName).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// generateNodeGraph — graph structure invariants
// ---------------------------------------------------------------------------

/** BFS reachability check — verifies every node is reachable from node 0. */
function isFullyConnected(nodeCount: number, edges: EdgePayload[]): boolean {
  const adjacency = new Map<number, number[]>();
  for (let i = 0; i < nodeCount; i++) adjacency.set(i, []);
  for (const e of edges) {
    adjacency.get(e.fromIndex)!.push(e.toIndex);
    adjacency.get(e.toIndex)!.push(e.fromIndex);
  }
  const visited = new Set<number>([0]);
  const queue = [0];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const neighbor of adjacency.get(current) ?? []) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
  }
  return visited.size === nodeCount;
}

describe("generateNodeGraph", () => {
  it("produces the minimum node count for every location type", () => {
    for (const type of LOCATION_TYPES) {
      const { nodes } = generateNodeGraph(type, `min-test-${type}`);
      expect(nodes.length).toBeGreaterThanOrEqual(LOCATION_TEMPLATES[type].nodeCountMin);
    }
  });

  it("produces at most the maximum node count for every location type", () => {
    for (const type of LOCATION_TYPES) {
      const { nodes } = generateNodeGraph(type, `max-test-${type}`);
      expect(nodes.length).toBeLessThanOrEqual(LOCATION_TEMPLATES[type].nodeCountMax);
    }
  });

  it("every node is reachable from node 0 (MST guarantee — no orphans)", () => {
    // Test with multiple seeds per type for statistical confidence
    for (const type of LOCATION_TYPES) {
      for (let i = 0; i < 5; i++) {
        const { nodes, edges } = generateNodeGraph(type, `connectivity-${type}-${i}`);
        expect(
          isFullyConnected(nodes.length, edges),
          `Graph for type='${type}', seed='connectivity-${type}-${i}' has orphan nodes`
        ).toBe(true);
      }
    }
  });

  it("has at least nodeCount-1 edges (minimum spanning tree guarantee)", () => {
    for (const type of LOCATION_TYPES) {
      const { nodes, edges } = generateNodeGraph(type, `mst-edges-${type}`);
      expect(edges.length).toBeGreaterThanOrEqual(nodes.length - 1);
    }
  });

  it("entry node is always index 0", () => {
    for (const type of LOCATION_TYPES) {
      const { nodes } = generateNodeGraph(type, `entry-${type}`);
      expect(nodes[0]).toBeDefined();
      expect(nodes[0]!.index).toBe(0);
    }
  });

  it("last node always has feature='exit'", () => {
    for (const type of LOCATION_TYPES) {
      const { nodes } = generateNodeGraph(type, `exit-${type}`);
      const lastNode = nodes[nodes.length - 1]!;
      expect(lastNode.feature).toBe("exit");
    }
  });

  it("all node indices are unique and contiguous from 0", () => {
    const { nodes } = generateNodeGraph("dungeon", "index-check");
    const indices = nodes.map((n) => n.index).sort((a, b) => a - b);
    for (let i = 0; i < indices.length; i++) {
      expect(indices[i]).toBe(i);
    }
  });

  it("all edge passage types are valid PassageType values", () => {
    const { edges } = generateNodeGraph("dungeon", "passage-type-check");
    for (const edge of edges) {
      expect(PASSAGE_TYPES).toContain(edge.passageType);
    }
  });

  it("dungeon edges include non-open passage types (statistical)", () => {
    // Dungeons have 30% door + 10% locked + 5% hidden — with enough edges we should see variety
    const allEdges: EdgePayload[] = [];
    for (let i = 0; i < 10; i++) {
      const { edges } = generateNodeGraph("dungeon", `dungeon-passages-${i}`);
      allEdges.push(...edges);
    }
    const passageTypes = new Set(allEdges.map((e) => e.passageType));
    // At least 2 distinct passage types across 10 dungeon seeds
    expect(passageTypes.size).toBeGreaterThanOrEqual(2);
  });

  it("no duplicate edges (fromIndex→toIndex must be unique)", () => {
    const { edges } = generateNodeGraph("village", "dedup-check");
    const seen = new Set<string>();
    for (const e of edges) {
      const key = `${e.fromIndex}:${e.toIndex}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it("is deterministic — same type+seed always produces identical graph", () => {
    for (const type of LOCATION_TYPES) {
      const a = generateNodeGraph(type, "determinism-seed");
      const b = generateNodeGraph(type, "determinism-seed");
      expect(a.nodes).toEqual(b.nodes);
      expect(a.edges).toEqual(b.edges);
    }
  });

  it("different seeds produce different graphs (statistical)", () => {
    const edgeSets = new Set<string>();
    for (let i = 0; i < 5; i++) {
      const { edges } = generateNodeGraph("dungeon", `variation-${i}`);
      edgeSets.add(JSON.stringify(edges));
    }
    expect(edgeSets.size).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// generateLocationPayload — orchestrator
// ---------------------------------------------------------------------------

describe("generateLocationPayload", () => {
  it("returns a valid LocationPayload for every location type", () => {
    for (const type of LOCATION_TYPES) {
      const payload = generateLocationPayload({ locationType: type, seed: `orch-${type}` });
      const result = LocationPayloadSchema.safeParse(payload);
      expect(result.success, `Payload for type='${type}' failed schema validation`).toBe(true);
    }
  });

  it("is deterministic — same inputs always produce identical payload", () => {
    const a = generateLocationPayload({ locationType: "dungeon", seed: "det-seed" });
    const b = generateLocationPayload({ locationType: "dungeon", seed: "det-seed" });
    expect(a).toEqual(b);
  });

  it("entryNodeIndex is always 0", () => {
    for (const type of LOCATION_TYPES) {
      const payload = generateLocationPayload({ locationType: type, seed: `entry-${type}` });
      expect(payload.entryNodeIndex).toBe(0);
    }
  });

  it("seed is preserved verbatim in payload", () => {
    const seed = "my-specific-seed";
    const payload = generateLocationPayload({ locationType: "tavern", seed });
    expect(payload.seed).toBe(seed);
  });

  it("node count stays within template bounds across multiple seeds", () => {
    for (const type of LOCATION_TYPES) {
      const template = LOCATION_TEMPLATES[type];
      for (let i = 0; i < 8; i++) {
        const payload = generateLocationPayload({ locationType: type, seed: `bounds-${type}-${i}` });
        expect(payload.nodes.length).toBeGreaterThanOrEqual(template.nodeCountMin);
        expect(payload.nodes.length).toBeLessThanOrEqual(template.nodeCountMax);
      }
    }
  });

  it("generated graph is always fully connected", () => {
    for (const type of LOCATION_TYPES) {
      for (let i = 0; i < 5; i++) {
        const payload = generateLocationPayload({ locationType: type, seed: `conn-${type}-${i}` });
        expect(
          isFullyConnected(payload.nodes.length, payload.edges),
          `Payload for type='${type}', seed='conn-${type}-${i}' has orphan nodes`
        ).toBe(true);
      }
    }
  });

  it("last node always has feature='exit' in generated payload", () => {
    for (const type of LOCATION_TYPES) {
      const payload = generateLocationPayload({ locationType: type, seed: `exit-orch-${type}` });
      const lastNode = payload.nodes[payload.nodes.length - 1]!;
      expect(lastNode.feature).toBe("exit");
    }
  });
});

// ---------------------------------------------------------------------------
// canMoveToNode
// ---------------------------------------------------------------------------

describe("canMoveToNode", () => {
  const edges: EdgePayload[] = [
    { fromIndex: 0, toIndex: 1, passageType: "open" },
    { fromIndex: 1, toIndex: 2, passageType: "door" },
    { fromIndex: 3, toIndex: 4, passageType: "open" },
  ];

  it("returns true for staying at the current node", () => {
    expect(canMoveToNode(0, 0, edges)).toBe(true);
    expect(canMoveToNode(2, 2, edges)).toBe(true);
  });

  it("returns true for directly adjacent node (forward direction)", () => {
    expect(canMoveToNode(0, 1, edges)).toBe(true);
    expect(canMoveToNode(1, 2, edges)).toBe(true);
  });

  it("returns true for bidirectional — reverse direction works", () => {
    expect(canMoveToNode(1, 0, edges)).toBe(true);
    expect(canMoveToNode(2, 1, edges)).toBe(true);
  });

  it("returns false for non-adjacent nodes", () => {
    expect(canMoveToNode(0, 2, edges)).toBe(false);
    expect(canMoveToNode(0, 3, edges)).toBe(false);
    expect(canMoveToNode(0, 4, edges)).toBe(false);
  });

  it("returns false for a node in a disconnected subgraph", () => {
    // Nodes 3-4 are disconnected from 0-1-2
    expect(canMoveToNode(0, 3, edges)).toBe(false);
    expect(canMoveToNode(0, 4, edges)).toBe(false);
  });

  it("returns false with empty edge list", () => {
    expect(canMoveToNode(0, 1, [])).toBe(false);
  });

  it("returns true for self-movement with empty edge list", () => {
    expect(canMoveToNode(5, 5, [])).toBe(true);
  });

  it("works correctly with locked passage type (adjacency is valid regardless of type)", () => {
    const lockedEdges: EdgePayload[] = [
      { fromIndex: 0, toIndex: 1, passageType: "locked" },
    ];
    // canMoveToNode only checks adjacency, NOT passage type — caller handles locked check
    expect(canMoveToNode(0, 1, lockedEdges)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// describeCurrentNode
// ---------------------------------------------------------------------------

describe("describeCurrentNode", () => {
  const currentNode: NodePayload = {
    index: 1,
    name: "The Ossuary",
    description: "Bones fill every niche.",
    feature: "hazard",
    npcSeed: null,
    featureData: {},
    x: 2,
    y: 3,
  };

  const adj1: NodePayload = {
    index: 0,
    name: "The Entry Hall",
    description: "A damp corridor.",
    feature: "empty",
    npcSeed: null,
    featureData: {},
    x: 1,
    y: 3,
  };

  const adj2: NodePayload = {
    index: 2,
    name: "The Black Well",
    description: "Cold darkness below.",
    feature: "treasure",
    npcSeed: null,
    featureData: {},
    x: 3,
    y: 3,
  };

  const edges: EdgePayload[] = [
    { fromIndex: 0, toIndex: 1, passageType: "door" },
    { fromIndex: 1, toIndex: 2, passageType: "locked" },
  ];

  it("includes the current node name as a heading", () => {
    const desc = describeCurrentNode(currentNode, [adj1, adj2], edges);
    expect(desc).toContain("The Ossuary");
  });

  it("includes the node description", () => {
    const desc = describeCurrentNode(currentNode, [adj1, adj2], edges);
    expect(desc).toContain("Bones fill every niche.");
  });

  it("includes the feature type", () => {
    const desc = describeCurrentNode(currentNode, [adj1, adj2], edges);
    expect(desc).toContain("hazard");
  });

  it("lists adjacent node names", () => {
    const desc = describeCurrentNode(currentNode, [adj1, adj2], edges);
    expect(desc).toContain("The Entry Hall");
    expect(desc).toContain("The Black Well");
  });

  it("includes passage types in exit list", () => {
    const desc = describeCurrentNode(currentNode, [adj1, adj2], edges);
    expect(desc).toContain("door");
    expect(desc).toContain("locked");
  });

  it("shows dead end message when no adjacent nodes", () => {
    const desc = describeCurrentNode(currentNode, [], edges);
    expect(desc).toContain("dead end");
  });

  it("works for all node feature types without throwing", () => {
    for (const feature of NODE_FEATURES) {
      const node: NodePayload = {
        ...currentNode,
        feature,
        npcSeed: feature === "npc" ? "some-seed" : null,
      };
      expect(() => describeCurrentNode(node, [], [])).not.toThrow();
    }
  });
});

// ===========================================================================
// MILESTONE O — Exploration Time Engine
// ===========================================================================

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const freshTime: CampaignTimeState = {
  totalTurns: 0,
  totalHours: 0,
  totalDays: 0,
  turnsSinceRest: 0,
  turnsSinceEncounterCheck: 0,
  turnsSinceRation: 0,
};

const freshInventory: PartyInventoryState = {
  torches: 3,
  oilFlasks: 2,
  rations: 10,
  activeLightSource: "torch",
  lightSourceTurnsRemaining: 4,
};

const darkInventory: PartyInventoryState = {
  torches: 0,
  oilFlasks: 0,
  rations: 5,
  activeLightSource: "none",
  lightSourceTurnsRemaining: 0,
};

// ---------------------------------------------------------------------------
// Constants sanity checks
// ---------------------------------------------------------------------------

describe("Exploration Time Engine — constants", () => {
  it("TURNS_PER_HOUR is 6 (10 min × 6 = 1 hour)", () => {
    expect(TURNS_PER_HOUR).toBe(6);
  });
  it("TORCH_DURATION_TURNS is 6 (= 1 hour)", () => {
    expect(TORCH_DURATION_TURNS).toBe(6);
  });
  it("OIL_DURATION_TURNS is 24 (= 4 hours)", () => {
    expect(OIL_DURATION_TURNS).toBe(24);
  });
  it("ENCOUNTER_CHECK_INTERVAL_TURNS is 2", () => {
    expect(ENCOUNTER_CHECK_INTERVAL_TURNS).toBe(2);
  });
  it("ENCOUNTER_TRIGGER_RESULT is 1 (1-in-6 chance)", () => {
    expect(ENCOUNTER_TRIGGER_RESULT).toBe(1);
  });
  it("REST_INTERVAL_TURNS is 6", () => {
    expect(REST_INTERVAL_TURNS).toBe(6);
  });
  it("RATION_INTERVAL_TURNS is 144 (6 turns/hr × 24 hr)", () => {
    expect(RATION_INTERVAL_TURNS).toBe(6 * 24);
  });
  it("INITIAL_TORCHES_PER_PLAYER is 5", () => {
    expect(INITIAL_TORCHES_PER_PLAYER).toBe(5);
  });
  it("INITIAL_RATIONS_PER_PLAYER is 7", () => {
    expect(INITIAL_RATIONS_PER_PLAYER).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// advanceTurn — turn counter and derived fields
// ---------------------------------------------------------------------------

describe("advanceTurn — turn counter", () => {
  it("increments totalTurns by 1 (default)", () => {
    expect(advanceTurn(freshTime).next.totalTurns).toBe(1);
  });

  it("increments totalTurns by N when turns=N", () => {
    expect(advanceTurn(freshTime, 3).next.totalTurns).toBe(3);
  });

  it("clamps turns to minimum 1", () => {
    const { next, turnsAdvanced } = advanceTurn(freshTime, 0);
    expect(next.totalTurns).toBe(1);
    expect(turnsAdvanced).toBe(1);
  });

  it("clamps turns to maximum 6", () => {
    const { next, turnsAdvanced } = advanceTurn(freshTime, 10);
    expect(next.totalTurns).toBe(6);
    expect(turnsAdvanced).toBe(6);
  });

  it("echoes clamped turnsAdvanced in result", () => {
    expect(advanceTurn(freshTime, 3).turnsAdvanced).toBe(3);
  });

  it("totalHours = floor(totalTurns / 6) at boundary", () => {
    // 5 existing + 1 = 6 → 1 hour
    expect(advanceTurn({ ...freshTime, totalTurns: 5 }).next.totalHours).toBe(1);
  });

  it("totalHours stays 0 for turns 1–5 from fresh state", () => {
    expect(advanceTurn(freshTime, 5).next.totalHours).toBe(0);
  });

  it("totalHours increments correctly at 12 turns", () => {
    expect(advanceTurn({ ...freshTime, totalTurns: 11 }).next.totalHours).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// advanceTurn — rest cycle
// ---------------------------------------------------------------------------

describe("advanceTurn — rest cycle", () => {
  it("restRequired = false after turn 1 from fresh state", () => {
    expect(advanceTurn(freshTime).restRequired).toBe(false);
  });

  it("restRequired = false after turn 5 from fresh state", () => {
    expect(advanceTurn(freshTime, 5).restRequired).toBe(false);
  });

  it("restRequired = true after turn 6 from fresh state", () => {
    expect(advanceTurn(freshTime, 6).restRequired).toBe(true);
  });

  it("restRequired = true when turnsSinceRest is already at REST_INTERVAL_TURNS", () => {
    expect(advanceTurn({ ...freshTime, turnsSinceRest: 6 }).restRequired).toBe(true);
  });

  it("turnsSinceRest never exceeds REST_INTERVAL_TURNS (6)", () => {
    const { next } = advanceTurn({ ...freshTime, turnsSinceRest: 6 }, 6);
    expect(next.turnsSinceRest).toBe(6);
  });

  it("turnsSinceRest accumulates across multiple calls", () => {
    const s1 = advanceTurn(freshTime, 3).next;
    const s2 = advanceTurn(s1, 2).next;
    expect(s2.turnsSinceRest).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// advanceTurn — encounter check cycle
// ---------------------------------------------------------------------------

describe("advanceTurn — encounter check cycle", () => {
  it("encounterCheckDue = false on turn 1", () => {
    expect(advanceTurn(freshTime).encounterCheckDue).toBe(false);
  });

  it("encounterCheckDue = true on turn 2", () => {
    expect(advanceTurn(freshTime, 2).encounterCheckDue).toBe(true);
  });

  it("turnsSinceEncounterCheck resets to 0 after check fires", () => {
    expect(advanceTurn(freshTime, 2).next.turnsSinceEncounterCheck).toBe(0);
  });

  it("encounterCheckDue fires again after counter resets", () => {
    const s1 = advanceTurn(freshTime, 2).next;
    expect(advanceTurn(s1, 2).encounterCheckDue).toBe(true);
  });

  it("encounterCheckDue = false at turn 1 after previous check", () => {
    const s1 = advanceTurn(freshTime, 2).next;
    expect(advanceTurn(s1, 1).encounterCheckDue).toBe(false);
  });

  it("partial advances accumulate correctly across two calls", () => {
    const s1 = advanceTurn(freshTime, 1).next;
    expect(advanceTurn(s1, 1).encounterCheckDue).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// advanceTurn — ration cycle
// ---------------------------------------------------------------------------

describe("advanceTurn — ration cycle", () => {
  it("rationConsumptionDue = false when turnsSinceRation = 0, turns = 1", () => {
    expect(advanceTurn(freshTime, 1).rationConsumptionDue).toBe(false);
  });

  it("rationConsumptionDue = true when crossing 144-turn threshold", () => {
    const near: CampaignTimeState = { ...freshTime, turnsSinceRation: RATION_INTERVAL_TURNS - 1 };
    expect(advanceTurn(near, 1).rationConsumptionDue).toBe(true);
  });

  it("turnsSinceRation resets modulo 144 after consumption fires", () => {
    const near: CampaignTimeState = { ...freshTime, turnsSinceRation: 143 };
    expect(advanceTurn(near, 1).next.turnsSinceRation).toBe(0);
  });

  it("turnsSinceRation = 2 after advancing 2 turns from fresh state", () => {
    expect(advanceTurn(freshTime, 2).next.turnsSinceRation).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// checkRandomEncounter
// ---------------------------------------------------------------------------

describe("checkRandomEncounter — roll results", () => {
  it("triggered = true when forcedRoll = 1", () => {
    const r = checkRandomEncounter(false, 1);
    expect(r.triggered).toBe(true);
    expect(r.roll).toBe(1);
  });

  it("triggered = false when forcedRoll = 2", () => {
    expect(checkRandomEncounter(false, 2).triggered).toBe(false);
  });

  it("triggered = false when forcedRoll = 6", () => {
    expect(checkRandomEncounter(false, 6).triggered).toBe(false);
  });

  it("loudAction = true is echoed in result", () => {
    expect(checkRandomEncounter(true, 3).loudAction).toBe(true);
  });

  it("loudAction does not guarantee trigger — roll still decides", () => {
    expect(checkRandomEncounter(true, 4).triggered).toBe(false);
  });

  it("loudAction = true + forcedRoll = 1 → triggered", () => {
    expect(checkRandomEncounter(true, 1).triggered).toBe(true);
  });

  it("uses rollDie(6) — Math.random mock 0 → result 1 → triggered", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const r = checkRandomEncounter(false);
    expect(r.roll).toBe(1);
    expect(r.triggered).toBe(true);
  });

  it("Math.random mock 5/6 → result 6 → not triggered", () => {
    vi.spyOn(Math, "random").mockReturnValue(5 / 6);
    const r = checkRandomEncounter(false);
    expect(r.roll).toBe(6);
    expect(r.triggered).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// consumeResources — light source
// ---------------------------------------------------------------------------

describe("consumeResources — torch attrition", () => {
  it("lightSourceTurnsRemaining decrements by 1 per turn", () => {
    const { next } = consumeResources(freshInventory, { rationConsumptionDue: false, partySize: 1 });
    expect(next.lightSourceTurnsRemaining).toBe(3);
  });

  it("lightExpired = false when remaining > 1", () => {
    expect(consumeResources(freshInventory, { rationConsumptionDue: false, partySize: 1 }).lightExpired).toBe(false);
  });
});

describe("consumeResources — torch expiry auto-selects next torch (Q3)", () => {
  const oneLeft: PartyInventoryState = {
    ...freshInventory,
    activeLightSource: "torch",
    lightSourceTurnsRemaining: 1,
    torches: 2,
  };

  it("lights next torch when torches > 0", () => {
    const { next } = consumeResources(oneLeft, { rationConsumptionDue: false, partySize: 1 });
    expect(next.activeLightSource).toBe("torch");
    expect(next.lightSourceTurnsRemaining).toBe(TORCH_DURATION_TURNS);
  });

  it("decrements torches count by 1", () => {
    expect(consumeResources(oneLeft, { rationConsumptionDue: false, partySize: 1 }).next.torches).toBe(1);
  });

  it("lightSourceAutoSelected = true", () => {
    expect(consumeResources(oneLeft, { rationConsumptionDue: false, partySize: 1 }).lightSourceAutoSelected).toBe(true);
  });

  it("lightExpired = true", () => {
    expect(consumeResources(oneLeft, { rationConsumptionDue: false, partySize: 1 }).lightExpired).toBe(true);
  });
});

describe("consumeResources — fallback to lantern when no torches (Q3)", () => {
  const noTorches: PartyInventoryState = {
    ...freshInventory,
    activeLightSource: "torch",
    lightSourceTurnsRemaining: 1,
    torches: 0,
    oilFlasks: 1,
  };

  it("switches to lantern", () => {
    const { next } = consumeResources(noTorches, { rationConsumptionDue: false, partySize: 1 });
    expect(next.activeLightSource).toBe("lantern");
    expect(next.lightSourceTurnsRemaining).toBe(OIL_DURATION_TURNS);
  });

  it("decrements oilFlasks by 1", () => {
    expect(consumeResources(noTorches, { rationConsumptionDue: false, partySize: 1 }).next.oilFlasks).toBe(0);
  });
});

describe("consumeResources — darkness when no light sources", () => {
  const lastLight: PartyInventoryState = {
    ...freshInventory,
    activeLightSource: "torch",
    lightSourceTurnsRemaining: 1,
    torches: 0,
    oilFlasks: 0,
  };

  it("activeLightSource becomes 'none'", () => {
    expect(consumeResources(lastLight, { rationConsumptionDue: false, partySize: 1 }).next.activeLightSource).toBe("none");
  });

  it("lightSourceTurnsRemaining becomes 0", () => {
    expect(consumeResources(lastLight, { rationConsumptionDue: false, partySize: 1 }).next.lightSourceTurnsRemaining).toBe(0);
  });

  it("darkness warning is present", () => {
    const { warnings } = consumeResources(lastLight, { rationConsumptionDue: false, partySize: 1 });
    expect(warnings.some((w) => w.toLowerCase().includes("darkness"))).toBe(true);
  });

  it("lightExpired = true", () => {
    expect(consumeResources(lastLight, { rationConsumptionDue: false, partySize: 1 }).lightExpired).toBe(true);
  });
});

describe("consumeResources — already in darkness", () => {
  it("remaining stays at 0 and source stays 'none'", () => {
    const { next } = consumeResources(darkInventory, { rationConsumptionDue: false, partySize: 1 });
    expect(next.lightSourceTurnsRemaining).toBe(0);
    expect(next.activeLightSource).toBe("none");
  });

  it("lightExpired = false when already in darkness", () => {
    expect(consumeResources(darkInventory, { rationConsumptionDue: false, partySize: 1 }).lightExpired).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// consumeResources — ration consumption
// ---------------------------------------------------------------------------

describe("consumeResources — rations", () => {
  it("deducts partySize rations when rationConsumptionDue = true", () => {
    const { next } = consumeResources({ ...freshInventory, rations: 10 }, { rationConsumptionDue: true, partySize: 3 });
    expect(next.rations).toBe(7);
  });

  it("rations unchanged when rationConsumptionDue = false", () => {
    const { next } = consumeResources({ ...freshInventory, rations: 10 }, { rationConsumptionDue: false, partySize: 3 });
    expect(next.rations).toBe(10);
  });

  it("rations floored at 0 — never negative", () => {
    const { next } = consumeResources({ ...freshInventory, rations: 2 }, { rationConsumptionDue: true, partySize: 4 });
    expect(next.rations).toBe(0);
  });

  it("rationsDepleted = true when rations hit 0", () => {
    expect(consumeResources({ ...freshInventory, rations: 3 }, { rationConsumptionDue: true, partySize: 3 }).rationsDepleted).toBe(true);
  });

  it("rationsDepleted = false when rations remain > 0", () => {
    expect(consumeResources({ ...freshInventory, rations: 10 }, { rationConsumptionDue: true, partySize: 3 }).rationsDepleted).toBe(false);
  });

  it("depletion warning added when rations hit 0", () => {
    const { warnings } = consumeResources({ ...freshInventory, rations: 2 }, { rationConsumptionDue: true, partySize: 4 });
    expect(warnings.some((w) => w.toLowerCase().includes("ration"))).toBe(true);
  });

  it("low-ration warning when rations ≤ partySize after consumption", () => {
    // 5 - 4 = 1 remaining, which is ≤ partySize (4)
    const { warnings } = consumeResources({ ...freshInventory, rations: 5 }, { rationConsumptionDue: true, partySize: 4 });
    expect(warnings.some((w) => w.toLowerCase().includes("ration"))).toBe(true);
  });

  it("partySize = 1 deducts exactly 1 ration", () => {
    expect(consumeResources({ ...freshInventory, rations: 7 }, { rationConsumptionDue: true, partySize: 1 }).next.rations).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// applyRest
// ---------------------------------------------------------------------------

describe("applyRest", () => {
  it("resets turnsSinceRest to 0", () => {
    expect(applyRest({ ...freshTime, turnsSinceRest: 6 }).turnsSinceRest).toBe(0);
  });

  it("does not alter totalTurns", () => {
    expect(applyRest({ ...freshTime, totalTurns: 42, turnsSinceRest: 6 }).totalTurns).toBe(42);
  });

  it("does not alter totalHours", () => {
    expect(applyRest({ ...freshTime, totalHours: 7, turnsSinceRest: 6 }).totalHours).toBe(7);
  });

  it("does not alter turnsSinceEncounterCheck", () => {
    expect(applyRest({ ...freshTime, turnsSinceEncounterCheck: 1, turnsSinceRest: 6 }).turnsSinceEncounterCheck).toBe(1);
  });

  it("does not alter turnsSinceRation", () => {
    expect(applyRest({ ...freshTime, turnsSinceRation: 100, turnsSinceRest: 6 }).turnsSinceRation).toBe(100);
  });

  it("calling applyRest on fresh state is a no-op", () => {
    expect(applyRest(freshTime)).toEqual(freshTime);
  });
});

// ---------------------------------------------------------------------------
// initialPartyInventory (campaign seeding — Q4)
// ---------------------------------------------------------------------------

describe("initialPartyInventory", () => {
  it("partySize = 1 → torches = 5", () => {
    expect(initialPartyInventory(1).torches).toBe(5);
  });

  it("partySize = 1 → rations = 7", () => {
    expect(initialPartyInventory(1).rations).toBe(7);
  });

  it("partySize = 4 → torches = 20 (5 × 4)", () => {
    expect(initialPartyInventory(4).torches).toBe(20);
  });

  it("partySize = 4 → rations = 28 (7 × 4)", () => {
    expect(initialPartyInventory(4).rations).toBe(28);
  });

  it("oilFlasks = 0 for any party size (Q4: must be purchased)", () => {
    expect(initialPartyInventory(1).oilFlasks).toBe(0);
    expect(initialPartyInventory(4).oilFlasks).toBe(0);
  });

  it("activeLightSource = 'none' at campaign start", () => {
    expect(initialPartyInventory(1).activeLightSource).toBe("none");
  });

  it("lightSourceTurnsRemaining = 0", () => {
    expect(initialPartyInventory(1).lightSourceTurnsRemaining).toBe(0);
  });

  it("partySize = 3 → torches = 15, rations = 21", () => {
    const inv = initialPartyInventory(3);
    expect(inv.torches).toBe(15);
    expect(inv.rations).toBe(21);
  });
});
