/**
 * tests/memory/formatter.test.ts
 *
 * Focused tests for prompt structure, NPC context, and relevance clipping.
 */

import { describe, it, expect } from "vitest";
import {
  formatSystemPrompt,
  formatNPCContext,
  formatSurvivalHUD,
  formatIronLaws,
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
  gold: 0,
  activeNPC: null,
};

/**
 * Was `resolvedEncounter`, carrying status/tensionScore/reason for a victory
 * branch the formatter no longer has — nothing ever populated those fields and
 * a resolved encounter reaches the formatter as `null`. Kept as an ordinary
 * active encounter so the containment guard below still covers a real combat
 * prompt rather than a second copy of the no-encounter one.
 */
const combatEncounter: CampaignContext["activeEncounter"] = {
  id: "enc-active-01",
  round: 4,
  currentTurnIndex: 0,
  totalDamageDealt: 0,
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

describe("formatSystemPrompt — no victory section", () => {
  /**
   * The formatter used to emit a "⚔️ VICTORY" block for an encounter whose
   * status was "resolved". Production could never produce that input:
   * `buildCampaignContext` queries `status: "active"`, and the pipeline flips
   * the row before narration runs, so a won encounter arrives as `null`.
   * This pins the absence so the branch is not reintroduced without also
   * making it reachable.
   */
  it("emits no victory block, for an active encounter or for none", () => {
    const withCombat = formatSystemPrompt({
      ...baseContext,
      activeEncounter: combatEncounter,
    });
    const withoutCombat = formatSystemPrompt(baseContext);

    for (const prompt of [withCombat, withoutCombat]) {
      expect(prompt).not.toContain("VICTORY");
      expect(prompt).not.toContain("Tension Score");
    }
    expect(withoutCombat).toContain("No active encounter.");
  });
});

const metNPC: ActiveNPC = {
  name: "Greta the Ironmonger",
  race: "dwarf",
  profession: "blacksmith",
  alignment: "lawful neutral",
  traits: {
    personality: "Speaks in short, hammered sentences.",
    ideal: "A debt paid is a debt forgotten.",
    bond: "The forge her father built.",
    flaw: "Will not admit when a piece is beyond saving.",
  },
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
    const output = formatNPCContext({ ...metNPC, disposition: 0 });
    expect(output).toContain("Greta the Ironmonger");
    expect(output).toContain("Indifferent");
    expect(output).toContain("left side of their jaw");
    expect(output).not.toContain("owe money to people");
  });

  it("marks unmet NPCs without requesting an unavailable tool", () => {
    const output = formatNPCContext({
      name: "Stranger",
      race: null,
      profession: null,
      alignment: null,
      traits: null,
      disposition: null,
      personalityTags: null,
      hasMetPlayer: false,
    });
    expect(output).toContain("Not yet met");
    expect(output).not.toContain("establishInitialDisposition");
  });
});

describe("formatNPCContext — persisted identity", () => {
  /**
   * `generateNPC` has always derived these and `NPC` has always had columns for
   * them, but no live path wrote them and no live path read them. The narrator
   * was left with a name and a disposition, and had to invent the person.
   */
  it("hands the narrator who the NPC is, not just how they feel", () => {
    const output = formatNPCContext(metNPC);

    expect(output).toContain("dwarf");
    expect(output).toContain("blacksmith");
    expect(output).toContain("lawful neutral");
  });

  it("gives all four trait pillars, which are the roleplay hooks", () => {
    const output = formatNPCContext(metNPC);

    expect(output).toContain("hammered sentences");
    expect(output).toContain("debt paid");
    expect(output).toContain("forge her father built");
    expect(output).toContain("beyond saving");
  });

  /**
   * The control: an NPC whose identity was never persisted must not produce
   * empty labels in the prompt. Absent is not the same as blank.
   */
  it("omits the identity line entirely when nothing was persisted", () => {
    const output = formatNPCContext({
      ...metNPC,
      race: null,
      profession: null,
      alignment: null,
      traits: null,
    });

    expect(output).not.toContain("Identity");
    expect(output).not.toContain("Personality:");
    expect(output).toContain("Greta the Ironmonger");
  });
});

describe("formatNPCContext — attitude", () => {
  it("names the attitude the rules would resolve", () => {
    const line = formatNPCContext({ ...metNPC, disposition: -8 });
    expect(line).toContain("Hostile");
    expect(line).not.toContain("Unfriendly");
    expect(line).not.toContain("Helpful");
  });

  it("withholds the secret at hostile and indifferent dispositions", () => {
    const hostile = formatNPCContext({ ...metNPC, disposition: -8 });
    const indifferent = formatNPCContext({ ...metNPC, disposition: 0 });

    expect(hostile).not.toContain("owe money to people");
    expect(indifferent).not.toContain("owe money to people");
  });

  /**
   * The boundary that proves the gate is the threshold and not the attitude.
   * Disposition 7 is Friendly — the top attitude — and the secret still does
   * not travel. Being liked is not the same as being trusted with this.
   */
  it("withholds the secret from a Friendly NPC below the threshold", () => {
    const friendlyButGuarded = formatNPCContext({ ...metNPC, disposition: 7 });

    expect(friendlyButGuarded).toContain("Friendly");
    expect(friendlyButGuarded).not.toContain("owe money to people");
  });

  it("gives the narrator the secret at the disclosure threshold", () => {
    const trusted = formatNPCContext({ ...metNPC, disposition: 8 });

    expect(trusted).toContain("owe money to people");
  });

  /**
   * The narrator receives the secret, so it no longer has to invent one — but
   * a fact handed over without a condition is a fact the model may volunteer
   * on its first turn. This asserts the constraint travels with the data.
   */
  it("tells the narrator the secret must be earned, not volunteered", () => {
    const trusted = formatNPCContext({ ...metNPC, disposition: 8 });

    expect(trusted).toContain("Do not volunteer it");
  });

  it("sends no secret line when the NPC has no personality tags", () => {
    const untagged = formatNPCContext({ ...metNPC, disposition: 8, personalityTags: null });

    expect(untagged).not.toContain("**Secret:**");
    expect(untagged).not.toContain("Do not volunteer it");
  });
});


describe("formatter narrator-tool containment", () => {
  const UNAVAILABLE_NARRATOR_TOOLS = [
    "establishInitialDisposition",
          "executeTrade",
      "generateAndTrackNPC",
    ];

  it("does not instruct the narrator to call an unavailable tool", () => {
    const prompts = [
      formatSystemPrompt(baseContext),
      formatSystemPrompt({ ...baseContext, activeEncounter: combatEncounter }),
      formatNPCContext({
        name: "Stranger",
        race: null,
        profession: null,
        alignment: null,
        traits: null,
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

describe("formatIronLaws — no wilderness watches", () => {
  /**
   * The Iron Laws reach the model every turn. This line described the hexcrawl
   * subsystem that the 2026-09-03 decision rejected; under SRD travel a day is
   * eight hours of marching, not six watches, so leaving it would state a rule
   * the engine does not implement.
   */
  it("states no watch structure", () => {
    const laws = formatIronLaws();
    expect(laws).not.toContain("watches");
    expect(laws).not.toContain("Wilderness day structure");
  });

  /** The control: the rest of the Iron Laws must survive. */
  it("keeps the laws that still hold", () => {
    const laws = formatIronLaws();
    expect(laws).toContain("Code is Law / State is Truth");
    expect(laws).toContain("Tooling Protocol");
  });
});
