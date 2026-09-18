import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  syncSceneParticipants,
  syncMaterializedNpcPresence,
  type ScenePresenceDb,
} from "@/lib/rules/scene-presence-service";
import { moveToNode } from "@/lib/rules/navigation";
import { resolveTravelGate } from "@/lib/actions/travel-command";
import { moveCampaignToNode } from "@/lib/rules/navigation-service";
import { generateExplorationLocation } from "@/lib/rules/exploration-service";
import { POST as postNpcRoute } from "@/app/api/campaign/[id]/npc/route";

let activePrismaDb: any = null;

vi.mock("@/lib/db/prisma", () => ({
  prisma: new Proxy(
    {},
    {
      get(_target, prop) {
        if (!activePrismaDb) {
          throw new Error("activePrismaDb not set in test");
        }
        return activePrismaDb[prop];
      },
    }
  ),
}));

vi.mock("@/lib/auth/session", () => ({
  getAuthUser: vi.fn(async () => ({ id: "u-1" })),
  AuthError: class extends Error {},
}));

vi.mock("@/lib/db/campaign-guard", () => ({
  campaignPlayableRefusal: vi.fn(async () => null),
  guardResponse: vi.fn(),
}));

interface InMemoryState {
  campaigns: Array<{
    id: string;
    userId: string;
    characterId?: string;
    currentLocationId?: string | null;
    currentNodeId?: string | null;
    scenePresenceVersion: number;
    status?: string;
  }>;
  participants: Array<{ campaignId: string; npcId: string }>;
  npcs: Array<{
    id: string;
    campaignId: string;
    seed: string;
    role: string;
    name: string;
    hp: number;
    maxHp: number;
    ac: number;
    notes: string;
  }>;
  locations: Array<{
    id: string;
    campaignId: string;
    seed: string;
    type: string;
    name: string;
    description: string;
    parentId: string | null;
  }>;
  nodes: Array<{
    id: string;
    locationId: string;
    index: number;
    name: string;
    description: string;
    feature: string;
    npcSeed: string | null;
    featureData?: Record<string, unknown>;
    x?: number;
    y?: number;
  }>;
  edges: Array<{
    id: string;
    locationId: string;
    fromNodeId: string;
    toNodeId: string;
    passageType: string;
  }>;
  logs: Array<{ campaignId: string; role: string; content: string }>;
}

function createInMemoryDb(initialState?: Partial<InMemoryState>) {
  const state: InMemoryState = {
    campaigns: initialState?.campaigns ? [...initialState.campaigns.map((c) => ({ ...c }))] : [],
    participants: initialState?.participants ? [...initialState.participants.map((p) => ({ ...p }))] : [],
    npcs: initialState?.npcs ? [...initialState.npcs.map((n) => ({ ...n }))] : [],
    locations: initialState?.locations ? [...initialState.locations.map((l) => ({ ...l }))] : [],
    nodes: initialState?.nodes ? [...initialState.nodes.map((n) => ({ ...n }))] : [],
    edges: initialState?.edges ? [...initialState.edges.map((e) => ({ ...e }))] : [],
    logs: initialState?.logs ? [...initialState.logs.map((l) => ({ ...l }))] : [],
  };

  const db = {
    state,
    campaign: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        return state.campaigns.find((c) => c.id === where.id) ?? null;
      }),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Partial<InMemoryState["campaigns"][0]>;
        }) => {
          const row = state.campaigns.find((c) => c.id === where.id);
          if (!row) throw new Error(`Campaign not found: ${where.id}`);
          Object.assign(row, data);
          return { ...row };
        }
      ),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: {
            id: string;
            currentLocationId?: string | null;
            currentNodeId?: string | null;
            scenePresenceVersion?: number;
          };
          data: Partial<InMemoryState["campaigns"][0]>;
        }) => {
          const matches = state.campaigns.filter((c) => {
            if (c.id !== where.id) return false;
            if (
              where.currentLocationId !== undefined &&
              c.currentLocationId !== where.currentLocationId
            ) {
              return false;
            }
            if (
              where.currentNodeId !== undefined &&
              c.currentNodeId !== where.currentNodeId
            ) {
              return false;
            }
            if (
              where.scenePresenceVersion !== undefined &&
              c.scenePresenceVersion !== where.scenePresenceVersion
            ) {
              return false;
            }
            return true;
          });
          for (const row of matches) {
            Object.assign(row, data);
          }
          return { count: matches.length };
        }
      ),
    },
    campaignSceneParticipant: {
      deleteMany: vi.fn(async ({ where }: { where: { campaignId: string } }) => {
        const prevLength = state.participants.length;
        state.participants = state.participants.filter(
          (p) => p.campaignId !== where.campaignId
        );
        return { count: prevLength - state.participants.length };
      }),
      create: vi.fn(
        async ({ data }: { data: { campaignId: string; npcId: string } }) => {
          const exists = state.participants.some(
            (p) => p.campaignId === data.campaignId && p.npcId === data.npcId
          );
          if (exists) {
            throw new Error(`Unique constraint failed on (campaignId, npcId)`);
          }
          const row = { ...data };
          state.participants.push(row);
          return row;
        }
      ),
      upsert: vi.fn(
        async ({
          where,
          create,
        }: {
          where: { campaignId_npcId: { campaignId: string; npcId: string } };
          create: { campaignId: string; npcId: string };
        }) => {
          const existing = state.participants.find(
            (p) =>
              p.campaignId === where.campaignId_npcId.campaignId &&
              p.npcId === where.campaignId_npcId.npcId
          );
          if (existing) return existing;
          const row = { ...create };
          state.participants.push(row);
          return row;
        }
      ),
    },
    nPC: {
      findUnique: vi.fn(
        async ({
          where,
        }: {
          where: { campaignId_seed: { campaignId: string; seed: string } };
        }) => {
          return (
            state.npcs.find(
              (n) =>
                n.campaignId === where.campaignId_seed.campaignId &&
                n.seed === where.campaignId_seed.seed
            ) ?? null
          );
        }
      ),
      upsert: vi.fn(
        async ({
          where,
          create,
          update,
        }: {
          where: { campaignId_seed: { campaignId: string; seed: string } };
          create: any;
          update: any;
        }) => {
          const existing = state.npcs.find(
            (n) =>
              n.campaignId === where.campaignId_seed.campaignId &&
              n.seed === where.campaignId_seed.seed
          );
          if (existing) {
            Object.assign(existing, update);
            return existing;
          }
          const created = { id: `npc_${state.npcs.length + 1}`, ...create };
          state.npcs.push(created);
          return created;
        }
      ),
    },
    location: {
      findUnique: vi.fn(async ({ where }: { where: { id?: string; campaignId_seed?: any } }) => {
        if (where.id) {
          const loc = state.locations.find((l) => l.id === where.id);
          if (!loc) return null;
          return {
            ...loc,
            nodes: state.nodes.filter((n) => n.locationId === loc.id),
            edges: state.edges.filter((e) => e.locationId === loc.id),
          };
        }
        if (where.campaignId_seed) {
          const loc = state.locations.find(
            (l) =>
              l.campaignId === where.campaignId_seed.campaignId &&
              l.seed === where.campaignId_seed.seed
          );
          if (!loc) return null;
          return {
            ...loc,
            nodes: state.nodes.filter((n) => n.locationId === loc.id),
            edges: state.edges.filter((e) => e.locationId === loc.id),
          };
        }
        return null;
      }),
      findFirst: vi.fn(async ({ where }: { where: { campaignId: string; name: any } }) => {
        return (
          state.locations.find(
            (l) =>
              l.campaignId === where.campaignId &&
              l.name.toLowerCase() === where.name.equals.toLowerCase()
          ) ?? null
        );
      }),
      findMany: vi.fn(async () => state.locations),
      create: vi.fn(async ({ data }: { data: any }) => {
        const row = { id: `loc_${state.locations.length + 1}`, ...data };
        state.locations.push(row);
        return row;
      }),
    },
    locationNode: {
      findUnique: vi.fn(async ({ where }: { where: { id?: string; locationId_index?: any } }) => {
        if (where.id) {
          return state.nodes.find((n) => n.id === where.id) ?? null;
        }
        if (where.locationId_index) {
          return (
            state.nodes.find(
              (n) =>
                n.locationId === where.locationId_index.locationId &&
                n.index === where.locationId_index.index
            ) ?? null
          );
        }
        return null;
      }),
      findFirst: vi.fn(async ({ where }: { where: { locationId: string } }) => {
        const matching = state.nodes.filter((n) => n.locationId === where.locationId);
        return matching[0] ?? null;
      }),
      create: vi.fn(async ({ data }: { data: any }) => {
        const row = { id: `node_${state.nodes.length + 1}`, ...data };
        state.nodes.push(row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: any }) => {
        const node = state.nodes.find((n) => n.id === where.id);
        if (node) Object.assign(node, data);
        return node;
      }),
    },
    locationEdge: {
      findMany: vi.fn(async ({ where }: { where: { locationId: string } }) => {
        return state.edges.filter((e) => e.locationId === where.locationId);
      }),
      create: vi.fn(async ({ data }: { data: any }) => {
        const row = { id: `edge_${state.edges.length + 1}`, ...data };
        state.edges.push(row);
        return row;
      }),
    },
    character: {
      findUnique: vi.fn(async () => null),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    gameLog: {
      create: vi.fn(async ({ data }: { data: any }) => {
        state.logs.push(data);
        return data;
      }),
    },
    $transaction: vi.fn(async (fn: (tx: any) => Promise<any>) => {
      const snapshot: InMemoryState = {
        campaigns: state.campaigns.map((c) => ({ ...c })),
        participants: state.participants.map((p) => ({ ...p })),
        npcs: state.npcs.map((n) => ({ ...n })),
        locations: state.locations.map((l) => ({ ...l })),
        nodes: state.nodes.map((n) => ({ ...n })),
        edges: state.edges.map((e) => ({ ...e })),
        logs: state.logs.map((l) => ({ ...l })),
      };
      try {
        return await fn(db);
      } catch (err) {
        state.campaigns = snapshot.campaigns;
        state.participants = snapshot.participants;
        state.npcs = snapshot.npcs;
        state.locations = snapshot.locations;
        state.nodes = snapshot.nodes;
        state.edges = snapshot.edges;
        state.logs = snapshot.logs;
        throw err;
      }
    }),
  };

  return db;
}

describe("DC-NARR-002B PR 2 — Authoritative Scene Presence Synchronization", () => {
  describe("Shared Scene-Presence Semantics", () => {
    it("CASE 1: version 0 + node without npcSeed -> clears participants, version -> 1", async () => {
      const db = createInMemoryDb({
        campaigns: [{ id: "camp-1", userId: "u-1", scenePresenceVersion: 0 }],
        participants: [{ campaignId: "camp-1", npcId: "stale-npc" }],
      });

      const result = await syncSceneParticipants(db as unknown as ScenePresenceDb, {
        campaignId: "camp-1",
        targetNodeNpcSeed: null,
      });

      expect(result).toMatchObject({
        type: "transition",
        case: 1,
        version: 1,
        participantCount: 0,
      });
      expect(db.state.participants).toEqual([]);
      expect(db.state.campaigns[0].scenePresenceVersion).toBe(1);
    });

    it("CASE 2: version 0 + node with npcSeed + matching persisted NPC -> establishes participant, version -> 1", async () => {
      const db = createInMemoryDb({
        campaigns: [{ id: "camp-1", userId: "u-1", scenePresenceVersion: 0 }],
        participants: [{ campaignId: "camp-1", npcId: "stale-npc" }],
        npcs: [
          {
            id: "npc-1",
            campaignId: "camp-1",
            seed: "innkeeper_john",
            role: "commoner",
            name: "John",
            hp: 4,
            maxHp: 4,
            ac: 10,
            notes: "",
          },
        ],
      });

      const result = await syncSceneParticipants(db as unknown as ScenePresenceDb, {
        campaignId: "camp-1",
        targetNodeNpcSeed: "innkeeper_john",
      });

      expect(result).toMatchObject({
        type: "transition",
        case: 2,
        version: 1,
        participantCount: 1,
        npcId: "npc-1",
      });
      expect(db.state.participants).toEqual([{ campaignId: "camp-1", npcId: "npc-1" }]);
      expect(db.state.campaigns[0].scenePresenceVersion).toBe(1);
    });

    it("CASE 3: version 0 + node with npcSeed + NO matching persisted NPC -> no participant, version remains 0", async () => {
      const db = createInMemoryDb({
        campaigns: [{ id: "camp-1", userId: "u-1", scenePresenceVersion: 0 }],
        participants: [{ campaignId: "camp-1", npcId: "stale-npc" }],
        npcs: [], // No matching NPC
      });

      const result = await syncSceneParticipants(db as unknown as ScenePresenceDb, {
        campaignId: "camp-1",
        targetNodeNpcSeed: "uncreated_npc_seed",
      });

      expect(result).toMatchObject({
        type: "transition",
        case: 3,
        version: 0,
        participantCount: 0,
      });
      // Stale participants cleared, no new participant, no NPC fabricated
      expect(db.state.participants).toEqual([]);
      expect(db.state.npcs).toHaveLength(0);
      expect(db.state.campaigns[0].scenePresenceVersion).toBe(0);
    });

    it("CASE 1: version 1 + node without npcSeed -> participants cleared, version remains >= 1", async () => {
      const db = createInMemoryDb({
        campaigns: [{ id: "camp-1", userId: "u-1", scenePresenceVersion: 1 }],
        participants: [{ campaignId: "camp-1", npcId: "old-npc" }],
      });

      const result = await syncSceneParticipants(db as unknown as ScenePresenceDb, {
        campaignId: "camp-1",
        targetNodeNpcSeed: null,
      });

      expect(result).toMatchObject({
        type: "transition",
        case: 1,
        version: 1,
        participantCount: 0,
      });
      expect(db.state.participants).toEqual([]);
      expect(db.state.campaigns[0].scenePresenceVersion).toBe(1);
      // update was NOT called because version was already >= 1
      expect(db.campaign.update).not.toHaveBeenCalled();
    });

    it("CASE 3: version 1 + node with missing persisted NPC -> participants cleared, canonical version preserved", async () => {
      const db = createInMemoryDb({
        campaigns: [{ id: "camp-1", userId: "u-1", scenePresenceVersion: 1 }],
        participants: [{ campaignId: "camp-1", npcId: "old-npc" }],
      });

      const result = await syncSceneParticipants(db as unknown as ScenePresenceDb, {
        campaignId: "camp-1",
        targetNodeNpcSeed: "missing_npc",
      });

      expect(result).toMatchObject({
        type: "transition",
        case: 3,
        version: 1,
        participantCount: 0,
      });
      expect(db.state.participants).toEqual([]);
      expect(db.state.campaigns[0].scenePresenceVersion).toBe(1);
      expect(db.campaign.update).not.toHaveBeenCalled();
    });

    it("Monotonicity: future version > 1 is never downgraded to 1", async () => {
      const db = createInMemoryDb({
        campaigns: [{ id: "camp-1", userId: "u-1", scenePresenceVersion: 3 }],
        participants: [{ campaignId: "camp-1", npcId: "old-npc" }],
      });

      const result = await syncSceneParticipants(db as unknown as ScenePresenceDb, {
        campaignId: "camp-1",
        targetNodeNpcSeed: null,
      });

      expect(result.version).toBe(3);
      expect(db.state.campaigns[0].scenePresenceVersion).toBe(3);
      expect(db.campaign.update).not.toHaveBeenCalled();
    });

    it("Repeat synchronization produces no duplicate participant rows", async () => {
      const db = createInMemoryDb({
        campaigns: [{ id: "camp-1", userId: "u-1", scenePresenceVersion: 1 }],
        npcs: [
          {
            id: "npc-1",
            campaignId: "camp-1",
            seed: "innkeeper",
            role: "commoner",
            name: "Innkeeper",
            hp: 4,
            maxHp: 4,
            ac: 10,
            notes: "",
          },
        ],
      });

      await syncSceneParticipants(db as unknown as ScenePresenceDb, {
        campaignId: "camp-1",
        targetNodeNpcSeed: "innkeeper",
      });
      expect(db.state.participants).toEqual([{ campaignId: "camp-1", npcId: "npc-1" }]);

      // Repeat synchronization with identical input
      await syncSceneParticipants(db as unknown as ScenePresenceDb, {
        campaignId: "camp-1",
        targetNodeNpcSeed: "innkeeper",
      });
      expect(db.state.participants).toEqual([{ campaignId: "camp-1", npcId: "npc-1" }]);
    });
  });

  describe("Authoritative Writer 1: intra-location moveToNode", () => {
    it("synchronizes scene presence when movement succeeds", async () => {
      const db = createInMemoryDb({
        campaigns: [
          {
            id: "camp-1",
            userId: "u-1",
            currentLocationId: "loc-1",
            currentNodeId: "node-1",
            scenePresenceVersion: 0,
          },
        ],
        locations: [
          {
            id: "loc-1",
            campaignId: "camp-1",
            seed: "seed-1",
            type: "dungeon",
            name: "Crypt",
            description: "",
            parentId: null,
          },
        ],
        nodes: [
          {
            id: "node-1",
            locationId: "loc-1",
            index: 0,
            name: "Entrance",
            description: "Entrance hall",
            feature: "empty",
            npcSeed: null,
          },
          {
            id: "node-2",
            locationId: "loc-1",
            index: 1,
            name: "Antechamber",
            description: "Antechamber",
            feature: "empty",
            npcSeed: "guard_steve",
          },
        ],
        edges: [
          {
            id: "edge-1",
            locationId: "loc-1",
            fromNodeId: "node-1",
            toNodeId: "node-2",
            passageType: "open",
          },
        ],
        npcs: [
          {
            id: "npc-steve",
            campaignId: "camp-1",
            seed: "guard_steve",
            role: "guard",
            name: "Steve",
            hp: 11,
            maxHp: 11,
            ac: 16,
            notes: "",
          },
        ],
      });

      const res = await moveToNode(db as any, "camp-1", "node-2");
      expect(res.success).toBe(true);
      expect(db.state.campaigns[0].currentNodeId).toBe("node-2");
      expect(db.state.campaigns[0].scenePresenceVersion).toBe(1);
      expect(db.state.participants).toEqual([
        { campaignId: "camp-1", npcId: "npc-steve" },
      ]);
    });

    it("failed movement CAS performs ZERO participant mutations", async () => {
      const db = createInMemoryDb({
        campaigns: [
          {
            id: "camp-1",
            userId: "u-1",
            currentLocationId: "loc-1",
            currentNodeId: "node-1",
            scenePresenceVersion: 1,
          },
        ],
        locations: [
          {
            id: "loc-1",
            campaignId: "camp-1",
            seed: "seed-1",
            type: "dungeon",
            name: "Crypt",
            description: "",
            parentId: null,
          },
        ],
        nodes: [
          {
            id: "node-1",
            locationId: "loc-1",
            index: 0,
            name: "Entrance",
            description: "",
            feature: "empty",
            npcSeed: null,
          },
          {
            id: "node-2",
            locationId: "loc-1",
            index: 1,
            name: "Antechamber",
            description: "",
            feature: "empty",
            npcSeed: "guard_steve",
          },
        ],
        edges: [
          {
            id: "edge-1",
            locationId: "loc-1",
            fromNodeId: "node-1",
            toNodeId: "node-2",
            passageType: "open",
          },
        ],
        participants: [{ campaignId: "camp-1", npcId: "existing-npc" }],
      });

      // Simulate concurrent movement winner changing position before updateMany
      db.campaign.updateMany.mockResolvedValueOnce({ count: 0 });

      const res = await moveToNode(db as any, "camp-1", "node-2");
      expect(res.success).toBe(false);
      expect(res.error).toMatch(/Party position changed/);

      // Participant state must be completely untouched!
      expect(db.state.participants).toEqual([
        { campaignId: "camp-1", npcId: "existing-npc" },
      ]);
      expect(db.campaignSceneParticipant.deleteMany).not.toHaveBeenCalled();
      expect(db.campaignSceneParticipant.create).not.toHaveBeenCalled();
    });
  });

  describe("Authoritative Writer 2: overland travel resolveTravelGate", () => {
    it("synchronizes scene presence when travel succeeds", async () => {
      const db = createInMemoryDb({
        campaigns: [
          {
            id: "camp-1",
            userId: "u-1",
            currentLocationId: "loc-origin",
            currentNodeId: "node-origin-0",
            scenePresenceVersion: 0,
          },
        ],
        locations: [
          {
            id: "loc-origin",
            campaignId: "camp-1",
            seed: "seed-origin",
            type: "village",
            name: "Oakhaven",
            description: "",
            parentId: null,
          },
          {
            id: "loc-dest",
            campaignId: "camp-1",
            seed: "seed-dest",
            type: "dungeon",
            name: "Sable Keep",
            description: "",
            parentId: null,
          },
        ],
        nodes: [
          {
            id: "node-dest-0",
            locationId: "loc-dest",
            index: 0,
            name: "Keep Gate",
            description: "",
            feature: "empty",
            npcSeed: "gate_sentry",
          },
        ],
        npcs: [
          {
            id: "npc-sentry",
            campaignId: "camp-1",
            seed: "gate_sentry",
            role: "guard",
            name: "Sentry",
            hp: 11,
            maxHp: 11,
            ac: 16,
            notes: "",
          },
        ],
        participants: [{ campaignId: "camp-1", npcId: "old-village-npc" }],
      });

      activePrismaDb = db;

      try {
        const result = await resolveTravelGate({
          campaignId: "camp-1",
          destination: "Sable Keep",
          forceMarch: false,
          hasActiveEncounter: false,
          originLocationId: "loc-origin",
          character: {
            id: "char-1",
            stats: { CON: 14 },
            exhaustionLevel: 0,
          },
          persistPlayerAction: async () => {},
        });

        expect(result).toBeNull(); // null means resolved
        expect(db.state.campaigns[0].currentLocationId).toBe("loc-dest");
        expect(db.state.campaigns[0].currentNodeId).toBe("node-dest-0");
        expect(db.state.campaigns[0].scenePresenceVersion).toBe(1);
        expect(db.state.participants).toEqual([
          { campaignId: "camp-1", npcId: "npc-sentry" },
        ]);
      } finally {
        activePrismaDb = null;
      }
    });

    it("failed travel CAS performs ZERO participant mutations", async () => {
      const db = createInMemoryDb({
        campaigns: [
          {
            id: "camp-1",
            userId: "u-1",
            currentLocationId: "loc-origin",
            currentNodeId: "node-origin-0",
            scenePresenceVersion: 1,
          },
        ],
        locations: [
          {
            id: "loc-origin",
            campaignId: "camp-1",
            seed: "seed-origin",
            type: "village",
            name: "Oakhaven",
            description: "",
            parentId: null,
          },
          {
            id: "loc-dest",
            campaignId: "camp-1",
            seed: "seed-dest",
            type: "dungeon",
            name: "Sable Keep",
            description: "",
            parentId: null,
          },
        ],
        nodes: [
          {
            id: "node-dest-0",
            locationId: "loc-dest",
            index: 0,
            name: "Keep Gate",
            description: "",
            feature: "empty",
            npcSeed: "gate_sentry",
          },
        ],
        participants: [{ campaignId: "camp-1", npcId: "existing-village-npc" }],
      });

      // Simulate CAS loser: origin already changed
      db.campaign.updateMany.mockResolvedValueOnce({ count: 0 });

      activePrismaDb = db;

      try {
        const response = await resolveTravelGate({
          campaignId: "camp-1",
          destination: "Sable Keep",
          forceMarch: false,
          hasActiveEncounter: false,
          originLocationId: "loc-origin",
          character: {
            id: "char-1",
            stats: { CON: 14 },
            exhaustionLevel: 0,
          },
          persistPlayerAction: async () => {},
        });

        expect(response).not.toBeNull();
        expect(response?.status).toBe(409);

        // Participants completely unchanged!
        expect(db.state.participants).toEqual([
          { campaignId: "camp-1", npcId: "existing-village-npc" },
        ]);
        expect(db.campaignSceneParticipant.deleteMany).not.toHaveBeenCalled();
      } finally {
        activePrismaDb = null;
      }
    });
  });

  describe("Authoritative Writer 3: AI exploration moveCampaignToNode", () => {
    it("synchronizes scene presence when AI navigation succeeds", async () => {
      const db = createInMemoryDb({
        campaigns: [
          {
            id: "camp-1",
            userId: "u-1",
            characterId: "char-1",
            currentLocationId: "loc-1",
            currentNodeId: "node-1",
            scenePresenceVersion: 0,
          },
        ],
        locations: [
          {
            id: "loc-1",
            campaignId: "camp-1",
            seed: "s1",
            type: "dungeon",
            name: "Crypt",
            description: "",
            parentId: null,
          },
        ],
        nodes: [
          {
            id: "node-1",
            locationId: "loc-1",
            index: 0,
            name: "Chamber",
            description: "",
            feature: "empty",
            npcSeed: null,
          },
          {
            id: "node-2",
            locationId: "loc-1",
            index: 1,
            name: "Hall",
            description: "",
            feature: "empty",
            npcSeed: "hall_npc",
          },
        ],
        edges: [
          {
            id: "edge-1",
            locationId: "loc-1",
            fromNodeId: "node-1",
            toNodeId: "node-2",
            passageType: "open",
          },
        ],
        npcs: [
          {
            id: "npc-hall",
            campaignId: "camp-1",
            seed: "hall_npc",
            role: "commoner",
            name: "Peasant",
            hp: 4,
            maxHp: 4,
            ac: 10,
            notes: "",
          },
        ],
      });

      const res = await moveCampaignToNode({
        campaignId: "camp-1",
        toNodeId: "node-2",
        tx: db as any,
      });

      expect(res.ok).toBe(true);
      expect(db.state.campaigns[0].currentNodeId).toBe("node-2");
      expect(db.state.campaigns[0].scenePresenceVersion).toBe(1);
      expect(db.state.participants).toEqual([{ campaignId: "camp-1", npcId: "npc-hall" }]);
    });
  });

  describe("Authoritative Writer 4: new location generation generateExplorationLocation", () => {
    it("synchronizes scene presence for initial entry node on location generation", async () => {
      const db = createInMemoryDb({
        campaigns: [
          {
            id: "camp-1",
            userId: "u-1",
            characterId: "char-1",
            currentLocationId: null,
            currentNodeId: null,
            scenePresenceVersion: 0,
          },
        ],
        participants: [{ campaignId: "camp-1", npcId: "stale-old-location-npc" }],
      });

      const res = await generateExplorationLocation({
        campaignId: "camp-1",
        userId: "u-1",
        locationType: "tavern",
        seed: "tavern-seed-1",
        tx: db as any,
      });

      expect(res.ok).toBe(true);
      expect(db.state.campaigns[0].currentLocationId).toBe(res.locationId);
      expect(db.state.campaigns[0].currentNodeId).toBe(res.initialNodeId);
      // Entry node of tavern has no npcSeed in default payload -> Case 1 promotes 0 -> 1 and clears stale participants
      expect(db.state.campaigns[0].scenePresenceVersion).toBe(1);
      expect(db.state.participants).toEqual([]);
    });

    it("synchronizes scene presence when existing location is reused", async () => {
      const db = createInMemoryDb({
        campaigns: [
          {
            id: "camp-1",
            userId: "u-1",
            characterId: "char-1",
            currentLocationId: null,
            currentNodeId: null,
            scenePresenceVersion: 0,
          },
        ],
        locations: [
          {
            id: "loc-existing",
            campaignId: "camp-1",
            seed: "existing-seed",
            type: "dungeon",
            name: "Old Dungeon",
            description: "",
            parentId: null,
          },
        ],
        nodes: [
          {
            id: "node-entry",
            locationId: "loc-existing",
            index: 0,
            name: "Entry",
            description: "",
            feature: "empty",
            npcSeed: "guard_at_door",
          },
        ],
        edges: [],
        npcs: [
          {
            id: "npc-door-guard",
            campaignId: "camp-1",
            seed: "guard_at_door",
            role: "guard",
            name: "Door Guard",
            hp: 11,
            maxHp: 11,
            ac: 16,
            notes: "",
          },
        ],
        participants: [{ campaignId: "camp-1", npcId: "stale-npc" }],
      });

      const res = await generateExplorationLocation({
        campaignId: "camp-1",
        userId: "u-1",
        locationType: "dungeon",
        seed: "existing-seed",
        tx: db as any,
      });

      expect(res.ok).toBe(true);
      expect(db.state.campaigns[0].currentLocationId).toBe("loc-existing");
      expect(db.state.campaigns[0].currentNodeId).toBe("node-entry");
      expect(db.state.campaigns[0].scenePresenceVersion).toBe(1);
      expect(db.state.participants).toEqual([
        { campaignId: "camp-1", npcId: "npc-door-guard" },
      ]);
    });
  });

  describe("Authoritative Writer 5: NPC materialization syncMaterializedNpcPresence", () => {
    it("materializing NPC matching current node seed in version 0 promotes version 0 -> 1 and establishes participant", async () => {
      const db = createInMemoryDb({
        campaigns: [
          {
            id: "camp-1",
            userId: "u-1",
            currentLocationId: "loc-1",
            currentNodeId: "node-tavern-room",
            scenePresenceVersion: 0,
          },
        ],
        nodes: [
          {
            id: "node-tavern-room",
            locationId: "loc-1",
            index: 0,
            name: "Tavern",
            description: "",
            feature: "empty",
            npcSeed: "bartender_bob",
          },
        ],
      });

      const res = await syncMaterializedNpcPresence(db as unknown as ScenePresenceDb, {
        campaignId: "camp-1",
        npcId: "npc-bob",
        npcSeed: "bartender_bob",
      });

      expect(res).toMatchObject({
        type: "materialize",
        modified: true,
        version: 1,
        npcId: "npc-bob",
      });
      expect(db.state.campaigns[0].scenePresenceVersion).toBe(1);
      expect(db.state.participants).toEqual([{ campaignId: "camp-1", npcId: "npc-bob" }]);
    });

    it("materializing NPC with seed DIFFERENT from current node seed produces ZERO scene presence mutation", async () => {
      const db = createInMemoryDb({
        campaigns: [
          {
            id: "camp-1",
            userId: "u-1",
            currentLocationId: "loc-1",
            currentNodeId: "node-tavern-room",
            scenePresenceVersion: 1,
          },
        ],
        nodes: [
          {
            id: "node-tavern-room",
            locationId: "loc-1",
            index: 0,
            name: "Tavern",
            description: "",
            feature: "empty",
            npcSeed: "bartender_bob",
          },
        ],
        participants: [{ campaignId: "camp-1", npcId: "npc-bob" }],
      });

      const res = await syncMaterializedNpcPresence(db as unknown as ScenePresenceDb, {
        campaignId: "camp-1",
        npcId: "npc-other",
        npcSeed: "castle_guard_far_away",
      });

      expect(res).toMatchObject({
        type: "materialize",
        modified: false,
        version: 1,
      });
      expect(db.state.participants).toEqual([{ campaignId: "camp-1", npcId: "npc-bob" }]);
      expect(db.campaignSceneParticipant.create).not.toHaveBeenCalled();
      expect(db.campaignSceneParticipant.deleteMany).not.toHaveBeenCalled();
    });

    it("materializing NPC in canonical multi-NPC scene does NOT erase unrelated existing participants", async () => {
      const db = createInMemoryDb({
        campaigns: [
          {
            id: "camp-1",
            userId: "u-1",
            currentLocationId: "loc-1",
            currentNodeId: "node-multi",
            scenePresenceVersion: 1,
          },
        ],
        nodes: [
          {
            id: "node-multi",
            locationId: "loc-1",
            index: 0,
            name: "Council Chamber",
            description: "",
            feature: "empty",
            npcSeed: "ambassador_elena",
          },
        ],
        participants: [
          { campaignId: "camp-1", npcId: "mayor_quimby" },
          { campaignId: "camp-1", npcId: "captain_clark" },
        ],
      });

      const res = await syncMaterializedNpcPresence(db as unknown as ScenePresenceDb, {
        campaignId: "camp-1",
        npcId: "ambassador_elena_id",
        npcSeed: "ambassador_elena",
      });

      expect(res).toMatchObject({
        type: "materialize",
        modified: true,
        version: 1,
      });
      // Both existing participants MUST survive plus the new one added!
      expect(db.state.participants).toEqual([
        { campaignId: "camp-1", npcId: "mayor_quimby" },
        { campaignId: "camp-1", npcId: "captain_clark" },
        { campaignId: "camp-1", npcId: "ambassador_elena_id" },
      ]);
      expect(db.campaignSceneParticipant.deleteMany).not.toHaveBeenCalled();
    });

    it("POST /api/campaign/[id]/npc atomically materializes NPC and synchronizes scene presence when seed matches current node", async () => {
      const db = createInMemoryDb({
        campaigns: [
          {
            id: "camp-1",
            userId: "u-1",
            currentLocationId: "loc-1",
            currentNodeId: "node-tavern-room",
            scenePresenceVersion: 0,
            status: "active",
          },
        ],
        nodes: [
          {
            id: "node-tavern-room",
            locationId: "loc-1",
            index: 0,
            name: "Tavern",
            description: "",
            feature: "empty",
            npcSeed: "bartender_bob",
          },
        ],
      });

      activePrismaDb = db;

      try {
        const req = new Request("http://localhost/api/campaign/camp-1/npc", {
          method: "POST",
          body: JSON.stringify({
            seed: "bartender_bob",
            role: "commoner",
          }),
        }) as any;

        const response = await postNpcRoute(req, {
          params: Promise.resolve({ id: "camp-1" }),
        });

        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data.seed).toBe("bartender_bob");
        expect(db.state.campaigns[0].scenePresenceVersion).toBe(1);
        expect(db.state.participants).toEqual([
          { campaignId: "camp-1", npcId: data.id },
        ]);
      } finally {
        activePrismaDb = null;
      }
    });

    it("POST /api/campaign/[id]/npc materializes NPC but leaves scene presence untouched when seed differs from current node", async () => {
      const db = createInMemoryDb({
        campaigns: [
          {
            id: "camp-1",
            userId: "u-1",
            currentLocationId: "loc-1",
            currentNodeId: "node-tavern-room",
            scenePresenceVersion: 1,
            status: "active",
          },
        ],
        nodes: [
          {
            id: "node-tavern-room",
            locationId: "loc-1",
            index: 0,
            name: "Tavern",
            description: "",
            feature: "empty",
            npcSeed: "bartender_bob",
          },
        ],
        participants: [{ campaignId: "camp-1", npcId: "npc-bob" }],
      });

      activePrismaDb = db;

      try {
        const req = new Request("http://localhost/api/campaign/camp-1/npc", {
          method: "POST",
          body: JSON.stringify({
            seed: "castle_guard_outside",
            role: "guard",
          }),
        }) as any;

        const response = await postNpcRoute(req, {
          params: Promise.resolve({ id: "camp-1" }),
        });

        expect(response.status).toBe(200);
        // Scene presence must be completely untouched
        expect(db.state.participants).toEqual([
          { campaignId: "camp-1", npcId: "npc-bob" },
        ]);
        expect(db.state.campaigns[0].scenePresenceVersion).toBe(1);
      } finally {
        activePrismaDb = null;
      }
    });
  });

  describe("Required Concurrency and Transactional Atomicity Guarantees", () => {
    it("transaction failure -> position and scene-presence changes roll back together", async () => {
      const db = createInMemoryDb({
        campaigns: [
          {
            id: "camp-1",
            userId: "u-1",
            currentLocationId: "loc-1",
            currentNodeId: "node-1",
            scenePresenceVersion: 0,
          },
        ],
        locations: [
          {
            id: "loc-1",
            campaignId: "camp-1",
            seed: "s1",
            type: "dungeon",
            name: "Crypt",
            description: "",
            parentId: null,
          },
        ],
        nodes: [
          {
            id: "node-1",
            locationId: "loc-1",
            index: 0,
            name: "Chamber",
            description: "",
            feature: "empty",
            npcSeed: null,
          },
          {
            id: "node-2",
            locationId: "loc-1",
            index: 1,
            name: "Hall",
            description: "",
            feature: "empty",
            npcSeed: "hall_npc",
          },
        ],
        edges: [
          {
            id: "edge-1",
            locationId: "loc-1",
            fromNodeId: "node-1",
            toNodeId: "node-2",
            passageType: "open",
          },
        ],
        participants: [{ campaignId: "camp-1", npcId: "initial-npc" }],
      });

      // Force participant synchronization to throw an error inside the transaction
      db.campaignSceneParticipant.deleteMany.mockRejectedValueOnce(
        new Error("Database connection lost during scene participant synchronization")
      );

      // Attempt transaction
      await expect(
        db.$transaction(async (tx) => {
          return moveToNode(tx as any, "camp-1", "node-2");
        })
      ).rejects.toThrow("Database connection lost during scene participant synchronization");

      // Both position and participants MUST remain in their original pre-transaction state!
      expect(db.state.campaigns[0].currentNodeId).toBe("node-1");
      expect(db.state.campaigns[0].scenePresenceVersion).toBe(0);
      expect(db.state.participants).toEqual([
        { campaignId: "camp-1", npcId: "initial-npc" },
      ]);
    });

    it("missing required delegates in test doubles safely return modified: false", async () => {
      const incompleteDb = {
        campaign: {
          findUnique: vi.fn(),
          update: vi.fn(),
        },
      } as unknown as ScenePresenceDb;

      const res1 = await syncSceneParticipants(incompleteDb, {
        campaignId: "camp-1",
        targetNodeNpcSeed: null,
      });
      expect(res1.modified).toBe(false);

      const res2 = await syncMaterializedNpcPresence(incompleteDb, {
        campaignId: "camp-1",
        npcId: "npc-1",
        npcSeed: "seed-1",
      });
      expect(res2.modified).toBe(false);
    });

    it("syncMaterializedNpcPresence returns modified: false when party has no currentNodeId", async () => {
      const db = createInMemoryDb({
        campaigns: [
          {
            id: "camp-1",
            userId: "u-1",
            currentLocationId: null,
            currentNodeId: null,
            scenePresenceVersion: 1,
          },
        ],
      });

      const res = await syncMaterializedNpcPresence(db as unknown as ScenePresenceDb, {
        campaignId: "camp-1",
        npcId: "npc-1",
        npcSeed: "some_seed",
      });

      expect(res).toMatchObject({
        type: "materialize",
        modified: false,
        version: 1,
      });
      expect(db.campaignSceneParticipant.create).not.toHaveBeenCalled();
    });

    it("CASE 2 preserves future version > 1 without downgrading", async () => {
      const db = createInMemoryDb({
        campaigns: [{ id: "camp-1", userId: "u-1", scenePresenceVersion: 2 }],
        participants: [{ campaignId: "camp-1", npcId: "stale-npc" }],
        npcs: [
          {
            id: "npc-2",
            campaignId: "camp-1",
            seed: "elder_mary",
            role: "commoner",
            name: "Mary",
            hp: 4,
            maxHp: 4,
            ac: 10,
            notes: "",
          },
        ],
      });

      const result = await syncSceneParticipants(db as unknown as ScenePresenceDb, {
        campaignId: "camp-1",
        targetNodeNpcSeed: "elder_mary",
      });

      expect(result).toMatchObject({
        type: "transition",
        case: 2,
        version: 2,
        participantCount: 1,
        npcId: "npc-2",
      });
      expect(db.state.participants).toEqual([{ campaignId: "camp-1", npcId: "npc-2" }]);
      expect(db.state.campaigns[0].scenePresenceVersion).toBe(2);
      expect(db.campaign.update).not.toHaveBeenCalled();
    });
  });
});
