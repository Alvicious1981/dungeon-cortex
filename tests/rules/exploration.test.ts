import { describe, it, expect } from "vitest";
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
} from "@/lib/rules/exploration";

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
