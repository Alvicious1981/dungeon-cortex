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
  skillProficiencies: null,
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
      damageImmunities: [],
      damageResistances: [],
      damageVulnerabilities: [],
      conditionImmunities: [],
      concentrationSpellId: null,
      x: 0,
      y: 0,
      size: "Medium",
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
  it("injects VICTORY guidance without unavailable narrator tools", () => {
    const prompt = formatSystemPrompt({
      ...baseContext,
      activeEncounter: resolvedEncounter,
    });

    expect(prompt).toContain("VICTORY");
    expect(prompt).toContain("backend action pipeline");
    expect(prompt).not.toContain("generateLoot");
    expect(prompt).not.toContain("awardXP");
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

  it("marks unmet NPCs without requesting an unavailable tool", () => {
    const output = formatNPCContext({
      name: "Stranger",
      disposition: null,
      personalityTags: null,
      hasMetPlayer: false,
    });
    expect(output).toContain("Not yet met");
    expect(output).not.toContain("establishInitialDisposition");
  });
});


describe("formatter narrator-tool containment", () => {
  const UNAVAILABLE_NARRATOR_TOOLS = [
    "establishInitialDisposition",
    "updateQuestStatus",
    "generateLoot",
    "awardXP",
    "executeTrade",
    "resolveAttack",
    "manageEquipment",
    "generateAndTrackNPC",
    "generateAndTrackQuest",
  ];

  it("does not instruct the narrator to call an unavailable tool", () => {
    const prompts = [
      formatSystemPrompt(baseContext),
      formatSystemPrompt({ ...baseContext, activeEncounter: resolvedEncounter }),
      formatNPCContext({
        name: "Stranger",
        disposition: null,
        personalityTags: null,
        hasMetPlayer: false,
      }),
    ];

    for (const prompt of prompts) {
      for (const toolName of UNAVAILABLE_NARRATOR_TOOLS) {
        expect(prompt).not.toContain(toolName);
      }
    }
  });

  it("limits the general tooling protocol to the temporary read-only surface", () => {
    const prompt = formatSystemPrompt(baseContext);

    expect(prompt).toContain("Only use a tool that is available in this request");
    expect(prompt).toContain("non-mutating reference lookups or deterministic generators");
    expect(prompt).toContain("does not establish a canonical fact");
    expect(prompt).toContain("backend context already identifies and authorizes");
    expect(prompt).not.toContain("call the relevant tool first");
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

  it("shows an informational rest notice without asserting a false mechanical consequence", () => {
    const output = formatSurvivalHUD({ ...baseHUD, turnsSinceRest: 6 });

    // 1. The informative rest notice still appears, reporting a true fact.
    expect(output).toContain("Rest:");
    expect(output).toContain("6 turn(s) since its last rest");

    // 2/3. Anti-regression: the prompt must NOT claim that skipping the
    // exploration rest cycle causes Exhaustion or any other backend-executed
    // consequence. executeExplorationTurn no longer increments exhaustionLevel,
    // so re-introducing this text would imply a mechanic the backend never runs.
    expect(output).not.toContain("Exhaustion");
    expect(output).not.toContain("mandatory");
    expect(output).not.toMatch(/applies on next/i);
  });

  it("reports rest turns with no threshold branching", () => {
    const below = formatSurvivalHUD({ ...baseHUD, turnsSinceRest: 2 });
    const above = formatSurvivalHUD({ ...baseHUD, turnsSinceRest: 9 });

    // Anti-regression: the retired 6-turn rest interval must not produce two
    // different prompt sentences. The counter is neutral elapsed time, so the
    // wording is identical on both sides of the old threshold.
    expect(below).toContain("2 turn(s) since its last rest");
    expect(above).toContain("9 turn(s) since its last rest");
    expect(below).not.toContain("since the last rest");
  });
});

describe("formatSystemPrompt — enemy damage and condition constraints", () => {
  /**
   * The snapshot the encounter service writes at spawn lives in its own
   * columns; `stats` only ever holds the six ability scores. These tests
   * pin the narrator's constraint line to the columns the combat pipeline
   * actually resolves against, so the prompt cannot contradict the engine.
   */
  const enemyCombatant: CampaignContext["activeEncounter"] = {
    id: "enc-active-01",
    round: 2,
    currentTurnIndex: 0,
    totalDamageDealt: 7,
    combatants: [
      {
        id: "cbt-zombie",
        name: "Zombie",
        isPlayer: false,
        hp: 16,
        maxHp: 22,
        ac: 8,
        initiativeTotal: 5,
        conditions: [],
        stats: { STR: 13, DEX: 6, CON: 16, INT: 3, WIS: 6, CHA: 5 },
        damageImmunities: ["poison"],
        damageResistances: ["cold", "necrotic"],
        damageVulnerabilities: ["radiant"],
        conditionImmunities: ["poisoned", "charmed"],
        concentrationSpellId: null,
        x: 1,
        y: 1,
        size: "Medium",
      },
    ],
  };

  it("states the enemy's damage immunities, resistances and vulnerabilities", () => {
    const prompt = formatSystemPrompt({
      ...baseContext,
      activeEncounter: enemyCombatant,
    });

    expect(prompt).toContain("Immune: poison");
    expect(prompt).toContain("Resist: cold, necrotic");
    expect(prompt).toContain("Vulnerable: radiant");
  });

  it("states the enemy's condition immunities", () => {
    const prompt = formatSystemPrompt({
      ...baseContext,
      activeEncounter: enemyCombatant,
    });

    expect(prompt).toContain("Cond Immune: poisoned, charmed");
  });

  it("omits the constraint line for a combatant with no modifiers", () => {
    const prompt = formatSystemPrompt({
      ...baseContext,
      activeEncounter: {
        ...enemyCombatant,
        combatants: [
          {
            ...enemyCombatant.combatants[0],
            damageImmunities: [],
            damageResistances: [],
            damageVulnerabilities: [],
            conditionImmunities: [],
          },
        ],
      },
    });

    expect(prompt).toContain("**Zombie** (Enemy) — AC: 8, HP: 16/22");
    expect(prompt).not.toContain("Immune:");
    expect(prompt).not.toContain("Resist:");
    expect(prompt).not.toContain("Vulnerable:");
  });
});
