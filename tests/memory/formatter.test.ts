/**
 * tests/memory/formatter.test.ts
 *
 * Focused tests for prompt structure, victory guidance, and relevance clipping.
 */

import { describe, it, expect } from "vitest";
import {
  formatSystemPrompt,
  formatNPCContext,
  formatSurvivalHUD,
  type ActiveNPC,
  type ExplorationHUDContext,
  type WildernessHUDContext,
  type HavenHUDContext,
} from "@/lib/memory/formatter";
import type { CampaignContext, ContextExploration } from "@/lib/memory/context";

const baseCharacter: CampaignContext["character"] = {
  id: "char-1",
  name: "Thalindra",
  race: "Elf",
  class: "wizard",
  level: 5,
  hp: 28,
  maxHp: 32,
  xp: 6500,
  stats: { STR: 8, DEX: 14, CON: 12, INT: 18, WIS: 14, CHA: 10 },
  spellSlots: null,
  concentrationSpellId: null,
  hitDiceTotal: 5,
  hitDiceRemaining: 3,
  exhaustionLevel: 0,
  inventory: [],
};

const baseContext: CampaignContext = {
  character: baseCharacter,
  activeEncounter: null,
  recentLogs: [],
  relevantMemories: [],
  quests: [],
  currentExploration: null,
};

const resolvedEncounter: CampaignContext["activeEncounter"] = {
  id: "enc-resolved-01",
  round: 4,
  currentTurnIndex: 0,
  totalDamageDealt: 0,
  status: "resolved",
  tensionScore: 0.73,
  reason: "all_enemies_dead",
  combatants: [
    {
      id: "cbt-player",
      name: "Thalindra",
      isPlayer: true,
      hp: 20,
      maxHp: 32,
      ac: 14,
      initiativeTotal: 18,
      conditions: [],
      stats: { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 },
      concentrationSpellId: null,
    },
  ],
};

function makeExploration(type: string = "dungeon"): ContextExploration {
  return {
    location: {
      id: "loc-1",
      name: "The Sable Crypt",
      type,
      description: "Cold stone halls echo with dripping water.",
    },
    currentNode: {
      index: 0,
      name: "Entry Hall",
      description: "A broken doorway opens into darkness.",
      feature: "empty",
      npcSeed: null,
      x: 0,
      y: 0,
    },
    adjacentNodes: [],
    visitedNodeIndices: [0],
    allNodes: [
      {
        index: 0,
        name: "Entry Hall",
        description: "A broken doorway opens into darkness.",
        feature: "empty",
        npcSeed: null,
        x: 0,
        y: 0,
      },
    ],
    allEdges: [],
  };
}

describe("formatSystemPrompt — core prompt contract", () => {
  it("includes concise Iron Laws with tool-protocol guidance", () => {
    const prompt = formatSystemPrompt(baseContext);
    expect(prompt).toContain("Iron Laws");
    expect(prompt).toContain("Tooling Protocol");
    expect(prompt).toContain("Code is Law / State is Truth");
  });

  it("includes hit dice in character state", () => {
    const prompt = formatSystemPrompt(baseContext);
    expect(prompt).toContain("Hit Dice:");
    expect(prompt).toContain("3/5 d6");
  });
});

describe("formatSystemPrompt — victory trigger section", () => {
  it("injects VICTORY guidance with generateLoot and awardXP", () => {
    const prompt = formatSystemPrompt({
      ...baseContext,
      activeEncounter: resolvedEncounter,
    });

    expect(prompt).toContain("VICTORY");
    expect(prompt).toContain("generateLoot");
    expect(prompt).toContain("awardXP");
    expect(prompt).toContain("0.73");
  });
});

const metNPC: ActiveNPC = {
  name: "Greta the Ironmonger",
  disposition: 5,
  personalityTags: {
    motivation: "To accumulate enough wealth to buy land and retire.",
    secret: "They owe money to people who will hurt their family if unpaid.",
    distinctiveTrait: "Always touches the left side of their jaw when thinking.",
  },
  hasMetPlayer: true,
};

describe("formatNPCContext", () => {
  it("renders visible NPC traits but keeps secret hidden", () => {
    const output = formatNPCContext(metNPC);
    expect(output).toContain("Greta the Ironmonger");
    expect(output).toContain("Friendly");
    expect(output).toContain("left side of their jaw");
    expect(output).not.toContain("owe money to people");
  });

  it("requires rollReaction for unmet NPCs", () => {
    const output = formatNPCContext({
      name: "Stranger",
      disposition: null,
      personalityTags: null,
      hasMetPlayer: false,
    });
    expect(output).toContain("rollReaction");
  });
});

const baseHUD: ExplorationHUDContext = {
  totalTurns: 12,
  totalHours: 2,
  turnsSinceRest: 3,
  activeLightSource: "torch",
  lightSourceTurnsRemaining: 4,
  torches: 2,
  oilFlasks: 1,
  rations: 8,
  exhaustionLevel: 0,
};

const baseWildernessHUD: WildernessHUDContext = {
  currentQ: 3,
  currentR: -2,
  terrain: "forest",
  biome: "temperate broadleaf forest",
  watchIndex: 1,
  totalDays: 4,
  weatherCondition: "rain",
  weatherIntensity: 1,
  partyPace: "normal",
  rations: 7,
  featureHere: false,
};

const baseHavenHUD: HavenHUDContext = {
  currentWealth: 120,
  havenUpkeep: 10,
  retainerMorale: "confident",
};

describe("formatSystemPrompt — relevance clipping", () => {
  it("injects exploration HUD only in dungeon/location scenes", () => {
    const withDungeon = formatSystemPrompt({
      ...baseContext,
      currentExploration: makeExploration("dungeon"),
      explorationHUD: baseHUD,
    });
    expect(withDungeon).toContain("Dungeon Clock");

    const withoutDungeon = formatSystemPrompt({
      ...baseContext,
      explorationHUD: baseHUD,
    });
    expect(withoutDungeon).not.toContain("Dungeon Clock");
  });

  it("injects wilderness HUD in overworld and clips it in dungeon scenes", () => {
    const overworldPrompt = formatSystemPrompt({
      ...baseContext,
      wildernessHUD: baseWildernessHUD,
    });
    expect(overworldPrompt).toContain("Wilderness & Travel Status");

    const dungeonPrompt = formatSystemPrompt({
      ...baseContext,
      currentExploration: makeExploration("dungeon"),
      wildernessHUD: baseWildernessHUD,
    });
    expect(dungeonPrompt).not.toContain("Wilderness & Travel Status");
  });

  it("injects haven HUD only in haven-like out-of-location scenes", () => {
    const havenPrompt = formatSystemPrompt({
      ...baseContext,
      havenHUD: baseHavenHUD,
    });
    expect(havenPrompt).toContain("Haven & Downtime Status");

    const locationPrompt = formatSystemPrompt({
      ...baseContext,
      currentExploration: makeExploration("dungeon"),
      havenHUD: baseHavenHUD,
    });
    expect(locationPrompt).not.toContain("Haven & Downtime Status");
  });

  it("injects NPC context only when activeNPC exists and no active encounter", () => {
    const socialPrompt = formatSystemPrompt({ ...baseContext, activeNPC: metNPC });
    expect(socialPrompt).toContain("🎭 NPC");

    const combatPrompt = formatSystemPrompt({
      ...baseContext,
      activeNPC: metNPC,
      activeEncounter: {
        id: "enc-1",
        round: 1,
        currentTurnIndex: 0,
        totalDamageDealt: 0,
        combatants: [],
      },
    });
    expect(combatPrompt).not.toContain("🎭 NPC");
  });
});

describe("formatSurvivalHUD", () => {
  it("renders time/light/ration data", () => {
    const output = formatSurvivalHUD(baseHUD);
    expect(output).toContain("12");
    expect(output).toContain("2h");
    expect(output).toContain("🕯️");
    expect(output).toContain("Rations");
  });

  it("shows overdue rest warning when rest is overdue", () => {
    const output = formatSurvivalHUD({ ...baseHUD, turnsSinceRest: 6 });
    expect(output).toContain("OVERDUE");
  });
});
